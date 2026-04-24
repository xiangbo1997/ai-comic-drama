/**
 * NOTE（Stage 3.5）：
 * `useUserStore` 目前未被组件消费——项目用 NextAuth session 读用户数据，积分通过
 * API 直接刷新。保留此 store 作为 **Stage 4 客户端积分乐观更新 / 离线偏好** 等场景
 * 的占位。接入时注意与 NextAuth session 的同步策略，避免双源真相。
 */

import { create } from "zustand";

interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  credits: number;
}

interface UserStore {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  updateCredits: (credits: number) => void;
  deductCredits: (amount: number) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  isLoading: true,

  setUser: (user) => set({ user, isLoading: false }),

  setIsLoading: (isLoading) => set({ isLoading }),

  updateCredits: (credits) =>
    set((state) => ({
      user: state.user ? { ...state.user, credits } : null,
    })),

  deductCredits: (amount) =>
    set((state) => ({
      user: state.user
        ? { ...state.user, credits: Math.max(0, state.user.credits - amount) }
        : null,
    })),
}));
