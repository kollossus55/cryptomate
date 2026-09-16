import { base44 } from './base44Client';

// File uploads are safe to call directly from client code — they don't
// consume integration credits the way InvokeLLM / GenerateImage etc. do.
// All credit-consuming Core integrations have been moved to backend functions.
export const UploadPublicFile = base44.integrations.Core.UploadPublicFile;
export const UploadPrivateFile = base44.integrations.Core.UploadPrivateFile;
export const CreateFileSignedUrl = base44.integrations.Core.CreateFileSignedUrl;