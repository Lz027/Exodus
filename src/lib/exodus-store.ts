import { initialThreads, type Thread } from "./exodus-data";
const THREADS_KEY = "exodus:threads";
const AUTH_KEY = "exodus:demo-auth";
export function loadThreads(): Thread[] { if (typeof window === "undefined") return initialThreads; try { const raw=localStorage.getItem(THREADS_KEY); if(raw) return JSON.parse(raw) as Thread[]; localStorage.setItem(THREADS_KEY,JSON.stringify(initialThreads)); } catch {} return initialThreads; }
export function saveThreads(threads: Thread[]) { if(typeof window!=="undefined") localStorage.setItem(THREADS_KEY,JSON.stringify(threads)); }
export function isDemoSignedIn(){ return typeof window!=="undefined" && localStorage.getItem(AUTH_KEY)==="true"; }
export function setDemoSignedIn(value:boolean){ if(typeof window!=="undefined") localStorage.setItem(AUTH_KEY,String(value)); }
