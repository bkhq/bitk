export interface AuthUser {
  sub: string
  username: string
  email: string
}

export interface OIDCDiscoveryDoc {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri?: string
}

export interface AuthConfig {
  enabled: boolean
  issuer: string
  clientId: string
  clientSecret: string
  allowedUsers: string[]
  secret: string
  pkce: boolean
  scopes: string
  usernameField: string
  sessionTtl: number
}

export interface TokenPayload {
  sub: string
  username: string
  email: string
  iat: number
  exp: number
}
