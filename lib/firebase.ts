// src/lib/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA185G_0E4LWQ4-tzxLakAMHEKSGpr5oQo",
  authDomain: "theatre-manager-86e4e.firebaseapp.com",
  projectId: "theatre-manager-86e4e",
  storageBucket: "theatre-manager-86e4e.firebasestorage.app",
  messagingSenderId: "659114061532",
  appId: "1:659114061532:web:52872e6d1a19c8b1068e19"
};

// すでに初期化済みなら再利用する
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
