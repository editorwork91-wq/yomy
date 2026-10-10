-- YOMY reaction consistency: one reaction per user per message.
-- Additive only; existing four reaction rows are already duplicate-free.

begin;

create unique index if not exists message_reactions_message_user_uidx
  on public.message_reactions(message_id, user_id);

commit;