"use client";
import React from "react";
import { createContext, useContext, type ReactNode } from "react";
export interface TenantContextValue { tenantId?: string; organizationName?: string; }
const TenantContext = createContext<TenantContextValue>({});
export function TenantProvider({ value, children }: { value: TenantContextValue; children: ReactNode }) { return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>; }
export function useTenant() { return useContext(TenantContext); }
export interface ApplicationContextValue { workspace?: string; userId?: string; }
const ApplicationContext = createContext<ApplicationContextValue>({});
export function ContextProvider({ value, children }: { value: ApplicationContextValue; children: ReactNode }) { return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>; }
export function useApplicationContext() { return useContext(ApplicationContext); }
