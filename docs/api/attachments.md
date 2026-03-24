# Attachments

## GET /api/projects/:projectId/issues/:id/attachments/:attachmentId

Download an attachment file.

Returns raw file stream with security headers:
- `Content-Type`: original MIME type
- `Content-Disposition: attachment` (SEC-024: forces download, prevents content-sniffing XSS)
- `X-Content-Type-Options: nosniff`
- `Cache-Control: private, max-age=86400`

Path is validated to stay within the upload directory via `realpath()` (SEC-025).
