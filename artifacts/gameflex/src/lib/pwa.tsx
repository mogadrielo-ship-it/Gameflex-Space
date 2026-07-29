import { useEffect, useState, useCallback } from 'react';

export function usePWA() {
  const [deferredPrompt, setDeferredPrompt] = useState(null as any);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler as any);

    const installedHandler = () => setIsInstalled(true);
    window.addEventListener('appinstalled', installedHandler);

    // iOS detection
    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /ipad|iphone|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIos(ios);

    // detect standalone for iOS/Android
    const checkStandalone = () => {
      const standalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
      setIsInstalled(!!standalone);
    };
    checkStandalone();

    window.addEventListener('load', checkStandalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler as any);
      window.removeEventListener('appinstalled', installedHandler);
      window.removeEventListener('load', checkStandalone);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return null;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return choice;
    } catch (e) {
      setDeferredPrompt(null);
      return null;
    }
  }, [deferredPrompt]);

  return { deferredPrompt, promptInstall, isInstalled, isIos } as const;
}
