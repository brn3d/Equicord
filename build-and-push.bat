@echo off
pnpm install --frozen-lockfile
if %errorlevel% neq 0 (echo Install failed & exit /b 1)

pnpm build
if %errorlevel% neq 0 (echo Build failed & exit /b 1)

git add -A
git commit -m "chore: build update"
git push
