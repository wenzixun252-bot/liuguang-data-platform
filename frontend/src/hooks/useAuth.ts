import { useState, useCallback } from 'react'
import type { User } from '../lib/auth'
import { getUser, getToken, setAuth, clearAuth } from '../lib/auth'

export function useAuth() {
  const [user, setUser] = useState<User | null>(getUser)
  const [token, setToken] = useState<string | null>(getToken)

  const login = useCallback((newToken: string, newUser: User) => {
    setAuth(newToken, newUser)
    setToken(newToken)
    setUser(newUser)
  }, [])

  const logout = useCallback(() => {
    clearAuth()
    setToken(null)
    setUser(null)
  }, [])

  return { user, token, isAuthenticated: !!token, login, logout }
}
