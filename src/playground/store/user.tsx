import { atom } from 'jotai'
import { UserInfo } from '../services/login.service'

export const userStore = atom<UserInfo | null>(null)
