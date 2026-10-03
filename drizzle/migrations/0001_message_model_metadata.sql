ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS model_label text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS capability text CHECK (capability IS NULL OR capability IN ('chat','coding','reasoning','vision'));
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS fallback_used boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','stopped','error'));
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS model_profile text;
CREATE POLICY exodus_storage_insert_chat ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='exodus-files' AND (storage.foldername(name))[1]=auth.uid()::text AND (storage.foldername(name))[2]='chat');