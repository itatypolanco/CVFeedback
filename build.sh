#!/bin/bash
# Build frontend
cd frontend
npm install
npm run build
cd ..

# Copiar dist al backend
cp -r frontend/dist backend/dist