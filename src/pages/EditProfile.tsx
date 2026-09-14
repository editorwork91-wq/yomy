import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Camera, ImagePlus } from 'lucide-react'

const PROFILE_AVATAR_BUCKET = 'profile-avatars'
const MAX_AVATAR_SIZE = 5 * 1024 * 1024

export default function EditProfile() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
      setUsername(profile.username)
      setBio(profile.bio || '')
      setAvatarUrl(profile.avatar_url || '')
    }
  }, [profile])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const handleFileSelected = (file: File | undefined) => {
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image')
      return
    }

    if (file.size > MAX_AVATAR_SIZE) {
      toast.error('Profile photo must be 5 MB or smaller')
      return
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const nextPreviewUrl = URL.createObjectURL(file)
    previewUrlRef.current = nextPreviewUrl
    setPendingAvatar(file)
    setPreviewUrl(nextPreviewUrl)
    setPreviewOpen(true)
  }

  const choosePhoto = () => fileInputRef.current?.click()

  const clearPendingAvatar = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    setPendingAvatar(null)
    setPreviewUrl(null)
    setPreviewOpen(false)
  }

  const uploadAvatar = async (file: File) => {
    if (!user) throw new Error('You must be signed in')

    setUploading(true)
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const safeExtension = /^[a-z0-9]+$/.test(extension) ? extension : 'jpg'
      const path = `${user.id}/avatar-${Date.now()}.${safeExtension}`

      const { data, error } = await supabase.storage
        .from(PROFILE_AVATAR_BUCKET)
        .upload(path, file, {
          cacheControl: '31536000',
          contentType: file.type,
          upsert: false,
        })

      if (error) throw error

      const { data: publicData } = supabase.storage
        .from(PROFILE_AVATAR_BUCKET)
        .getPublicUrl(data.path)

      if (!publicData.publicUrl) throw new Error('Could not create profile photo URL')
      return publicData.publicUrl
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!user || !profile) return
    if (username.length < 3) {
      toast.error('Username must be at least 3 characters')
      return
    }

    setSaving(true)
    try {
      if (username !== profile.username) {
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', username.toLowerCase())
          .neq('id', user.id)
          .maybeSingle()

        if (existing) {
          toast.error('Username already taken')
          return
        }
      }

      let nextAvatarUrl = avatarUrl
      if (pendingAvatar) {
        nextAvatarUrl = await uploadAvatar(pendingAvatar)
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          username: username.toLowerCase(),
          bio,
          avatar_url: nextAvatarUrl,
        })
        .eq('id', user.id)

      if (error) throw error

      setAvatarUrl(nextAvatarUrl)
      clearPendingAvatar()
      await refreshProfile()
      toast.success('Profile saved!')
      navigate(`/profile/${username}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    )
  }

  const displayedAvatar = previewUrl || avatarUrl

  return (
    <div className="pb-20">
      <TopBar
        title="Edit profile"
        showBack
        right={
          <Button
            variant="ghost"
            size="sm"
            className="text-primary font-semibold"
            disabled={saving || uploading}
            onClick={handleSave}
          >
            {saving || uploading ? <Spinner className="size-4" /> : 'Save'}
          </Button>
        }
      />

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex flex-col items-center gap-3 mb-6">
          <button
            type="button"
            className="relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            onClick={choosePhoto}
            disabled={saving || uploading}
            aria-label="Change profile photo"
          >
            <Avatar className="size-24 ring-2 ring-border">
              <AvatarImage src={displayedAvatar} alt="Profile photo" />
              <AvatarFallback className="text-3xl">
                {profile.username[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="absolute bottom-0 right-0 bg-primary rounded-full size-8 flex items-center justify-center ring-2 ring-background">
              {uploading ? (
                <Spinner className="size-4 text-primary-foreground" />
              ) : (
                <Camera className="size-4 text-primary-foreground" />
              )}
            </span>
          </button>

          <button
            type="button"
            className="text-sm font-semibold text-primary disabled:opacity-50"
            onClick={choosePhoto}
            disabled={saving || uploading}
          >
            Change photo
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              handleFileSelected(e.target.files?.[0])
              e.currentTarget.value = ''
            }}
          />
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your full name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_.]/gi, '').toLowerCase())}
              placeholder="username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Write a little about yourself..."
              maxLength={150}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">{bio.length}/150</p>
          </div>
        </div>

        <Button
          className="w-full mt-8"
          size="lg"
          disabled={saving || uploading}
          onClick={handleSave}
        >
          {saving || uploading ? <Spinner className="size-4 mr-2" /> : null}
          Save Changes
        </Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={open => !open && clearPendingAvatar()}>
        <DialogContent className="max-w-sm rounded-2xl p-5">
          <DialogHeader className="text-center">
            <DialogTitle>Preview profile photo</DialogTitle>
            <DialogDescription>
              This is how your new profile photo will look.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center py-4">
            <div className="size-56 rounded-full overflow-hidden bg-muted ring-4 ring-background shadow-xl">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="New profile photo preview"
                  className="size-full object-cover"
                />
              ) : (
                <div className="size-full flex items-center justify-center">
                  <ImagePlus className="size-10 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={clearPendingAvatar}>
              Cancel
            </Button>
            <Button type="button" onClick={() => setPreviewOpen(false)}>
              Use photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
