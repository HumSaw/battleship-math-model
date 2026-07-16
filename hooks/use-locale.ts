'use client'

import { useEffect, useState } from 'react'
import {
  detectLocale,
  getMessages,
  localeDirection,
  type Locale,
} from '@/lib/i18n'

const STORAGE_KEY = 'admiral-locale'

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    const initial = saved ? detectLocale(saved) : detectLocale(window.navigator.language)
    setLocaleState(initial)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = localeDirection(locale)
  }, [locale])

  const setLocale = (next: Locale) => {
    setLocaleState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  return {
    locale,
    setLocale,
    messages: getMessages(locale),
    direction: localeDirection(locale),
  }
}
