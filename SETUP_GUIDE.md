# 🏥 HealthDrop Surveillance System - Complete Setup Guide

## 📋 Project Overview

**HealthDrop** is a **React Native/Expo** mobile application designed for real-time disease surveillance and early warning system for water-borne diseases, particularly targeting rural Northeast India.

### Key Features
- 🔐 User authentication with email/OTP verification
- 👥 Role-based access (Admin, Clinic, ASHA Worker, Volunteer)
- 🦠 Disease outbreak monitoring and alerts
- 💧 Water quality tracking
- 🚨 Real-time warning system
- 🌙 Dark/Light theme support
- 📱 Cross-platform (iOS, Android, Web)

---

## 🛠️ Prerequisites

Before running this project, ensure you have the following installed:

### Required Software
| Software | Minimum Version | Download Link |
|----------|-----------------|---------------|
| **Node.js** | v20.19.4+ (recommended) | [nodejs.org](https://nodejs.org/) |
| **npm** | v10.0+ | Comes with Node.js |
| **Expo CLI** | Latest | Installed via npm |
| **Git** | Any recent | [git-scm.com](https://git-scm.com/) |

### Optional (For Mobile Development)
| Software | Purpose |
|----------|---------|
| **Android Studio** | Android emulator & development |
| **Xcode** (macOS only) | iOS simulator & development |
| **Expo Go App** | Test on physical device |

---

## 🚀 Quick Start

### Step 1: Install Dependencies

Open a terminal in the project folder and run:

```bash
npm install
```

### Step 2: Start the Development Server

```bash
# Start Expo development server
npm start

# OR for specific platforms:
npm run android    # Android emulator
npm run ios        # iOS simulator (macOS only)
npm run web        # Web browser
npm run tunnel     # For testing on physical devices over network
```

### Step 3: Run the App

After starting the server:
1. **Physical Device**: Scan the QR code with Expo Go app (iOS/Android)
2. **Emulator**: Press `a` for Android or `i` for iOS in the terminal
3. **Web**: Press `w` to open in browser

---

## 🗄️ Database Setup (Supabase)

This project uses **Supabase** as the backend database. The project comes with pre-configured Supabase credentials.

### Current Configuration
The app is connected to a Supabase project with the following configuration:
- **URL**: `https://hzicxykqtlxhaalgqkey.supabase.co`
- **Anon Key**: Pre-configured in `lib/supabase.ts`

### ⚠️ Important: Setting Up Your Own Supabase Project

If you want to use your own Supabase instance, follow these steps:

#### 1. Create a Supabase Account
Go to [supabase.com](https://supabase.com) and create a free account.

#### 2. Create a New Project
- Click "New Project"
- Choose your organization
- Enter project name and database password
- Select your region
- Click "Create new project"

#### 3. Set Up Database Tables

Go to **SQL Editor** in Supabase and run the following SQL:

```sql
-- Create profiles table
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'clinic', 'asha_worker', 'volunteer')),
  organization TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to view their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Create policy to allow users to insert their own profile
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create policy to allow users to update their own profile
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Optional: Create index for faster queries
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_location ON public.profiles(location);
```

#### 4. Configure Authentication

In Supabase Dashboard:
1. Go to **Authentication** → **Providers**
2. Enable **Email** provider
3. Configure email templates if needed
4. Optionally enable OTP-based authentication

#### 5. Update App Configuration

Edit `lib/supabase.ts` with your project credentials:

```typescript
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';
```

Find these values in Supabase Dashboard → **Settings** → **API**

---

## 📁 Project Structure

```
Health-Drop-Surveillance-System/
├── App.tsx                 # Main app entry point
├── index.ts               # App registration
├── package.json           # Dependencies & scripts
├── tsconfig.json          # TypeScript configuration
├── app.json               # Expo configuration
│
├── components/            # Reusable UI components
│   ├── AuthScreen.tsx     # Login/Signup screens
│   ├── ProfileSetup.tsx   # Profile creation wizard
│   ├── Navbar.tsx         # Top navigation bar
│   ├── Sidebar.tsx        # Side navigation menu
│   ├── HeroSection.tsx    # Dashboard hero section
│   └── Card.tsx           # Alert/info cards
│
├── pages/                 # Main application pages
│   ├── IndexPage.tsx      # Main dashboard
│   └── SettingsPage.tsx   # Settings & preferences
│
├── lib/                   # Utilities & context
│   ├── supabase.ts        # Supabase client config
│   └── ThemeContext.tsx   # Theme provider
│
├── types/                 # TypeScript type definitions
│   └── profile.ts         # Profile types
│
├── assets/                # Images & icons
│   ├── app_logo.png       # App logo
│   ├── icon.png           # App icon
│   └── splash-icon.png    # Splash screen
│
└── mesc/                  # Miscellaneous docs
    ├── Documentation.md   # Additional docs
    └── user_guide.md      # User guide
```

---

## 👤 User Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| **Admin** | System administrators | Full access to all features |
| **Clinic** | Healthcare facilities | Upload patient/disease reports |
| **ASHA Worker** | Community health workers | Upload field symptoms/cases |
| **Volunteer** | Community volunteers | Upload environmental observations |

---

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start Expo development server |
| `npm run android` | Run on Android emulator |
| `npm run ios` | Run on iOS simulator |
| `npm run web` | Run in web browser |
| `npm run tunnel` | Start with tunnel for physical devices |

---

## 📦 Dependencies

### Production Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `expo` | ~54.0.7 | React Native framework |
| `react` | 19.1.0 | UI library |
| `react-native` | 0.81.4 | Mobile framework |
| `@supabase/supabase-js` | ^2.39.7 | Database client |
| `@react-native-async-storage/async-storage` | ^2.2.0 | Local storage |
| `expo-secure-store` | ~15.0.7 | Secure storage |
| `expo-status-bar` | ~3.0.8 | Status bar control |
| `react-native-url-polyfill` | ^2.0.0 | URL polyfill |

### Development Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ~5.9.2 | TypeScript compiler |
| `@babel/core` | ^7.25.0 | JavaScript compiler |
| `@types/react` | ~19.1.10 | TypeScript types |

---

## 🔐 Authentication Flow

1. **New User Sign Up**:
   - Enter email, password, and profile details
   - Receive OTP via email
   - Verify OTP to complete registration
   - Profile is created in database

2. **Existing User Login**:
   - Enter email and password
   - Automatic session management
   - Profile data loaded from database

3. **Session Management**:
   - Auto-refresh tokens
   - Persistent sessions using AsyncStorage
   - Secure logout functionality

---

## ⚠️ Troubleshooting

### Common Issues

#### 1. Node.js Version Warning
```
npm warn EBADENGINE Unsupported engine
```
**Solution**: Update Node.js to v20.19.4 or later

#### 2. Metro Bundler Issues
```bash
# Clear cache and restart
npx expo start -c
```

#### 3. Supabase Connection Error
- Verify your internet connection
- Check Supabase project status
- Verify API keys are correct

#### 4. Expo Go App Issues
```bash
# Use tunnel mode for physical devices
npm run tunnel
```

#### 5. Build Errors
```bash
# Clean install
rm -rf node_modules
rm package-lock.json
npm install
```

---

## 🌐 Environment Variables (Optional)

For production deployments, create a `.env` file:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

Then update `lib/supabase.ts` to use environment variables.

---

## 📱 Testing on Physical Devices

1. Install **Expo Go** from App Store or Play Store
2. Run `npm run tunnel` in your project
3. Scan the QR code with Expo Go
4. The app will load on your device

---

## 🚀 Building for Production

### Android APK
```bash
npx expo build:android
```

### iOS IPA
```bash
npx expo build:ios
```

### EAS Build (Recommended)
```bash
npx eas build --platform all
```

---

## 📞 Support

For issues or questions:
- Check existing [GitHub Issues](https://github.com)
- Create a new issue with detailed description
- Include error logs and screenshots

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Happy Coding! 🎉**
