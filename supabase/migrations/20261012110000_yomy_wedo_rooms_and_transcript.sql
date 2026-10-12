-- Wedo! private friend rooms, direct-chat invitations, and timestamp-preserving transcript.
CREATE TABLE IF NOT EXISTS public.wedo_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Wedo!',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  CONSTRAINT wedo_rooms_distinct_people CHECK (created_by <> friend_id)
);

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_wedo_message boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wedo_room_id uuid REFERENCES public.wedo_rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wedo_rooms_creator_status_idx ON public.wedo_rooms(created_by,status,created_at DESC);
CREATE INDEX IF NOT EXISTS wedo_rooms_friend_status_idx ON public.wedo_rooms(friend_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS messages_wedo_room_idx ON public.messages(wedo_room_id,created_at) WHERE is_wedo_message = true;
CREATE UNIQUE INDEX IF NOT EXISTS messages_wedo_transcript_unique_idx ON public.messages(wedo_room_id,client_message_id) WHERE wedo_room_id IS NOT NULL AND client_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wedo_room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.wedo_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  client_message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wedo_room_messages_client_id_unique UNIQUE (room_id,client_message_id)
);

ALTER TABLE public.wedo_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedo_room_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wedo_rooms_participant_select ON public.wedo_rooms;
CREATE POLICY wedo_rooms_participant_select ON public.wedo_rooms
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR auth.uid() = friend_id);

DROP POLICY IF EXISTS wedo_messages_participant_select ON public.wedo_room_messages;
CREATE POLICY wedo_messages_participant_select ON public.wedo_room_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedo_rooms r
    WHERE r.id = room_id AND (auth.uid() = r.created_by OR auth.uid() = r.friend_id)
  ));

DROP POLICY IF EXISTS wedo_messages_participant_insert ON public.wedo_room_messages;
CREATE POLICY wedo_messages_participant_insert ON public.wedo_room_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.wedo_rooms r
      WHERE r.id = room_id AND r.status = 'active'
        AND (auth.uid() = r.created_by OR auth.uid() = r.friend_id)
    )
  );

GRANT SELECT ON public.wedo_rooms TO authenticated;
GRANT SELECT, INSERT ON public.wedo_room_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.create_wedo_room(p_friend_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE v_room_id uuid; v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_friend_id IS NULL OR p_friend_id = v_me THEN RAISE EXCEPTION 'WEDO_INVALID_FRIEND' USING ERRCODE='22023'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id=v_me AND f.following_id=p_friend_id AND f.status='accepted')
     OR NOT EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id=p_friend_id AND f.following_id=v_me AND f.status='accepted') THEN
    RAISE EXCEPTION 'WEDO_FRIENDS_ONLY' USING ERRCODE='42501';
  END IF;

  IF public.is_user_sleeping(p_friend_id) THEN
    RAISE EXCEPTION 'WEDO_PEER_SLEEPING' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.wedo_rooms(created_by,friend_id,title)
  VALUES(v_me,p_friend_id,'Wedo!')
  RETURNING id INTO v_room_id;

  INSERT INTO public.messages(
    sender_id,receiver_id,content,media_url,media_type,is_encrypted,view_once,
    view_once_opened,is_wedo_message,wedo_room_id,message_type,media_bucket,client_message_id
  ) VALUES (
    v_me,p_friend_id,'Wedo! room invitation','','',false,false,
    false,true,v_room_id,'wedo_invite','messages','wedo-invite:'||v_room_id::text
  );

  RETURN v_room_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_wedo_room(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  UPDATE public.wedo_rooms
    SET started_at=COALESCE(started_at,now())
    WHERE id=p_room_id AND status='active'
      AND (created_by=auth.uid() OR friend_id=auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'WEDO_ROOM_NOT_FOUND' USING ERRCODE='42501'; END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_wedo_room(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  UPDATE public.wedo_rooms
    SET status='ended',
        ended_at=now(),
        duration_seconds=GREATEST(0,EXTRACT(EPOCH FROM (now()-COALESCE(started_at,created_at)))::integer)
    WHERE id=p_room_id AND status='active'
      AND (created_by=auth.uid() OR friend_id=auth.uid());
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.wedo_rooms
    WHERE id=p_room_id AND status='ended' AND (created_by=auth.uid() OR friend_id=auth.uid())
  ) THEN RAISE EXCEPTION 'WEDO_ROOM_NOT_FOUND' USING ERRCODE='42501'; END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_wedo_transcript()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE v_summary text;
BEGIN
  IF OLD.status IS DISTINCT FROM 'ended' AND NEW.status='ended' THEN
    INSERT INTO public.messages(
      sender_id,receiver_id,content,media_url,media_type,is_seen,is_encrypted,view_once,
      view_once_opened,deleted_for_everyone,is_request,request_accepted,message_type,
      media_bucket,client_message_id,view_once_limit,view_once_open_count,
      created_at,is_wedo_message,wedo_room_id
    )
    SELECT
      m.sender_id,
      CASE WHEN m.sender_id=NEW.created_by THEN NEW.friend_id ELSE NEW.created_by END,
      m.content,'','',false,false,false,false,false,false,true,'text',
      'messages','wedo:'||m.id::text,0,0,m.created_at,true,NEW.id
    FROM public.wedo_room_messages m
    WHERE m.room_id=NEW.id
    ORDER BY m.created_at,m.id
    ON CONFLICT (wedo_room_id,client_message_id) WHERE wedo_room_id IS NOT NULL AND client_message_id IS NOT NULL DO NOTHING;

    v_summary := 'Wedo! · Session ended. Room chat saved.';
    INSERT INTO public.messages(
      sender_id,receiver_id,content,media_url,media_type,is_seen,is_encrypted,view_once,
      view_once_opened,deleted_for_everyone,is_request,request_accepted,message_type,
      media_bucket,client_message_id,view_once_limit,view_once_open_count,
      created_at,is_wedo_message,wedo_room_id
    ) VALUES (
      NEW.created_by,NEW.friend_id,
      v_summary || CASE WHEN NEW.duration_seconds IS NOT NULL THEN ' Duration: '||NEW.duration_seconds::text||'s.' ELSE '' END,
      '','',false,false,false,false,false,false,true,'text',
      'messages','wedo-summary:'||NEW.id::text,0,0,COALESCE(NEW.ended_at,now()),true,NEW.id
    ) ON CONFLICT (wedo_room_id,client_message_id) WHERE wedo_room_id IS NOT NULL AND client_message_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS wedo_archive_transcript_on_end ON public.wedo_rooms;
CREATE TRIGGER wedo_archive_transcript_on_end
AFTER UPDATE OF status ON public.wedo_rooms
FOR EACH ROW EXECUTE FUNCTION public.archive_wedo_transcript();

REVOKE ALL ON FUNCTION public.archive_wedo_transcript() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_wedo_room(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_wedo_room(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_wedo_room(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wedo_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_wedo_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_wedo_room(uuid) TO authenticated;

DROP POLICY IF EXISTS wedo_private_channel_read ON realtime.messages;
CREATE POLICY wedo_private_channel_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() LIKE 'wedo-%'
    AND EXISTS (
      SELECT 1 FROM public.wedo_rooms r
      WHERE r.id::text=substring(realtime.topic() FROM 6)
        AND (auth.uid()=r.created_by OR auth.uid()=r.friend_id)
    )
  );

DROP POLICY IF EXISTS wedo_private_channel_broadcast ON realtime.messages;
CREATE POLICY wedo_private_channel_broadcast ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() LIKE 'wedo-%'
    AND EXISTS (
      SELECT 1 FROM public.wedo_rooms r
      WHERE r.id::text=substring(realtime.topic() FROM 6)
        AND (auth.uid()=r.created_by OR auth.uid()=r.friend_id)
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='wedo_rooms') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wedo_rooms;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='wedo_room_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wedo_room_messages;
    END IF;
  END IF;
END $$;
