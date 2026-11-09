# Famabria on F-Droid

The Android app is a thin WebView shell (`android/`) around the web app (`dist/web`, bundled in `android/app/src/main/assets/app`). No Google services, no analytics, only dependency: `androidx.webkit` (Apache-2.0).

## Build locally / in CI
    npm ci && npm run build:web && npm run android:assets
    cd android && gradle assembleDebug      # APK in app/build/outputs/apk/debug
GitHub Actions (`.github/workflows/android.yml`) does this on every `v*` tag and attaches `famabria-debug.apk` to the release.

## Submit to F-Droid (one time)
1. Fork https://gitlab.com/fdroid/fdroiddata
2. Add `metadata/com.famabria.app.yml` (draft below)
3. Open a merge request; the F-Droid bot builds it and reviewers comment.
4. Each new release: bump `versionCode`/`versionName` in `android/app/build.gradle`, tag `vX.Y.Z`; F-Droid auto-updates from tags.

## Draft metadata/com.famabria.app.yml
    Categories:
      - Time
    License: MIT
    AuthorName: Rosario Savoia
    WebSite: https://famabria.com
    SourceCode: https://github.com/rosariosai/famabria
    IssueTracker: https://github.com/rosariosai/famabria/issues
    AutoName: Famabria
    RepoType: git
    Repo: https://github.com/rosariosai/famabria.git
    Builds:
      - versionName: 2.10.1
        versionCode: 21001
        commit: v2.10.1
        subdir: android/app
        sudo:
          - apt-get update
          - apt-get install -y npm
        init: cd ../.. && npm ci && npm run build:web && npm run android:assets
        gradle:
          - yes
    AutoUpdateMode: Version
    UpdateCheckMode: Tags
    CurrentVersion: 2.10.1
    CurrentVersionCode: 21001

Notes: the fastlane metadata (title, description, icon, phone screenshots, changelog per versionCode) is in `android/fastlane/metadata/android/en-US`. F-Droid may ask for a newer Node than the apt one: then use `sudo` to install Node 22 from nodesource.
Anti-feature check: none expected (no tracking, no non-free network service required; the relay is optional and self-hosted).
