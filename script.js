// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBh7taAf24ZUd8eqfspSIyAEKaeZDklHa8",
  authDomain: "bit-buster.firebaseapp.com",
  projectId: "bit-buster",
  storageBucket: "bit-buster.firebasestorage.app",
  messagingSenderId: "523871466535",
  appId: "1:523871466535:web:87e13e4c26b78b97564a02",
  measurementId: "G-ZZYR4332HH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);