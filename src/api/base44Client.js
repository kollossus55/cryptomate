import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion } = appParams;

//Create a client with authentication required.
// serverUrl is hardcoded to '' (platform origin) — never pass a client-
// supplied serverUrl here, or the user's Bearer token would be sent to an
// attacker-controlled origin.
export const base44 = createClient({
  appId,
  serverUrl: '',
  token,
  functionsVersion,
  requiresAuth: false
});