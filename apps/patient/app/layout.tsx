import type { Metadata } from "next";import type { ReactNode } from "react";import {AppShell} from "@medlink/ui";import "@medlink/ui/styles.css";import "./globals.css";
export const metadata:Metadata={title:"MedLink Patient",description:"Find and reserve medication"};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><body className="ml-body"><AppShell brand={<a href="/">MedLink Patient</a>} navigation={[{label:"My requests",href:"/"},{label:"Find medicine",href:"/search"},{label:"Notifications",href:"/notifications"}]}>{children}</AppShell></body></html>}
