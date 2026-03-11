export interface User {
  feishu_open_id: string
  name: string
  avatar_url: string | null
  email: string | null
  role: 'employee' | 'executive' | 'admin'
}

export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function getUser(): User | null {
  const raw = localStorage.getItem('user')
  return raw ? JSON.parse(raw) : null
}

export function setAuth(token: string, user: User) {
  localStorage.setItem('token', token)
  localStorage.setItem('user', JSON.stringify(user))
}

export function clearAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin'
}

export function getAdminMode(): boolean {
  return localStorage.getItem('admin_mode') === 'true'
}

export function setAdminMode(enabled: boolean) {
  localStorage.setItem('admin_mode', String(enabled))
}

export function toggleAdminMode(): boolean {
  const next = !getAdminMode()
  setAdminMode(next)
  return next
}
