ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS requested_model_id text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS fallback_reason text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_request_id text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS output_tokens integer;
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_request_uq ON public.messages (conversation_id, role, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON public.messages (conversation_id, created_at);
DROP POLICY IF EXISTS exodus_messages_delete_own ON public.messages;
CREATE POLICY exodus_messages_delete_own ON public.messages FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('request','fallback','rate_limit','error','transcribe','speak')),
  capability text,
  requested_model_id text,
  actual_model_id text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_select_own ON public.usage_events FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY usage_insert_own ON public.usage_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY usage_delete_own ON public.usage_events FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS usage_events_user_created_idx ON public.usage_events (user_id, created_at DESC);