// ============================================================
//  FIREBASE CONFIG  —  EDIT THIS ONE BLOCK ONLY
// ============================================================
// Paste the config object Firebase gives you (Step 3 of SETUP_GUIDE.txt)
// between the { } below. Nothing else in any file needs changing.

const firebaseConfig = {
  apiKey: "AIzaSyB5JCbADIpgJguCplwBrAXWraNsbEiRxFw",
  authDomain: "live-crew-dashboard.firebaseapp.com",
  projectId: "live-crew-dashboard",
  storageBucket: "live-crew-dashboard.firebasestorage.app",
  messagingSenderId: "824823126792",
  appId: "1:824823126792:web:261bf7cc54089ec7f66abd",
  measurementId: "G-EWXKKQ477B"
};

// ------------------------------------------------------------
// Do not edit below this line.
// ------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
