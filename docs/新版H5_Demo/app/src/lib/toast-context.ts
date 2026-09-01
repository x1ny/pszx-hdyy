import { createContext, useContext } from 'react'

export interface ToastApi {
  show: (text: string) => void
}

export const ToastContext = createContext<ToastApi>({ show: () => {} })

/** Show a top-center lightweight toast (auto-dismiss after 2s). */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
