// @ts-nocheck
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { track } from '@/lib/analytics';

type Profile = Tables<'profiles'>;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<{ error: Error | null }>;
  register: (email: string, password: string, username: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const generateReferralCode = (username?: string) => {
    const base = String(username ?? '')
      .replace(/[^A-Z0-9]/gi, '')
      .slice(0, 6)
      .toUpperCase();
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${base || 'GF'}${suffix}`.slice(0, 10);
  };

  const getPendingReferralCode = () => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('gameflex_referral_code');
  };

  const clearPendingReferralCode = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('gameflex_referral_code');
  };

  const applyPendingReferral = async (userId: string) => {
    const referralCode = getPendingReferralCode();
    if (!referralCode) return;

    const { data: referrer, error: referrerError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('referral_code', referralCode)
      .maybeSingle();

    if (referrerError || !referrer?.user_id || referrer.user_id === userId) return;

    const { data: existing, error: existingError } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_id', userId)
      .maybeSingle();

    if (existingError || existing) return;

    await supabase.from('referrals').insert({
      referrer_id: referrer.user_id,
      referred_id: userId,
      status: 'pending',
    });

    clearPendingReferralCode();
  };

  const fetchProfile = async (userId: string, metadata?: any) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (data) {
      if (!data.referral_code) {
        const referral_code = generateReferralCode(data.username);
        await supabase
          .from('profiles')
          .update({ referral_code })
          .eq('user_id', userId);
        setProfile({ ...data, referral_code });
        return { ...data, referral_code };
      }
      setProfile(data);
      return data;
    }

    const username = metadata?.username || `Player${Math.floor(1000 + Math.random() * 9000)}`;
    const profileData = {
      user_id: userId,
      username,
      email: metadata?.email ?? null,
      referral_code: generateReferralCode(username),
    };

    const { data: inserted } = await supabase
      .from('profiles')
      .insert(profileData)
      .select('*')
      .maybeSingle();

    setProfile(inserted ?? profileData);
    return inserted ?? profileData;
  };

  const checkAdminRole = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    
    setIsAdmin(!!data);
  };

  useEffect(() => {
    let isActive = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isActive) return;
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          void Promise.all([
            fetchProfile(session.user.id),
            checkAdminRole(session.user.id),
          ]);
        } else {
          setProfile(null);
          setIsAdmin(false);
        }
      },
    );

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isActive) return;
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        void Promise.all([
          fetchProfile(session.user.id),
          checkAdminRole(session.user.id),
        ]);
      }

      setIsLoading(false);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error) void track('login', { method: email.includes('@gameflex.app') ? 'phone' : 'email' });
    return { error: error ? new Error(error.message) : null };
  };

  const register = async (email: string, password: string, username: string, referralCode?: string) => {
    if (typeof window !== 'undefined' && referralCode) {
      localStorage.setItem('gameflex_referral_code', referralCode);
    }

    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          username,
        },
      },
    });
    if (!error) void track('signup', { username });
    return { error: error ? new Error(error.message) : null };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setIsAdmin(false);
  };

  const updateProfile = async (data: Partial<Profile>) => {
    if (!user) return { error: new Error('Not authenticated') };
    
    const { error } = await supabase
      .from('profiles')
      .update(data)
      .eq('user_id', user.id);
    
    if (!error) {
      await fetchProfile(user.id);
    }
    
    return { error: error ? new Error(error.message) : null };
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isLoading,
        isAuthenticated: !!user,
        isAdmin,
        login,
        register,
        logout,
        updateProfile,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
