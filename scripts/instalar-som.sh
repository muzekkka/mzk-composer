#!/usr/bin/env bash
# Instala o que o `./mzk render` precisa para gerar o mp3: SuperCollider (o motor de
# som, roda escondido) e ffmpeg (mixagem final e mp3). Pede a senha do Linux uma vez.
set -euo pipefail

echo "MZK Composer — instalando o motor de som do mp3"
echo "Vai pedir a sua senha do Linux (nada aparece enquanto você digita; é normal)."
echo

sudo apt-get update -qq
sudo apt-get install -y supercollider-server supercollider-language ffmpeg

echo
if command -v scsynth >/dev/null && command -v ffmpeg >/dev/null; then
  echo "Pronto! Para gerar o mp3 de uma composição:"
  echo "  ./mzk render MZK-0001"
else
  echo "Algo não instalou. Copie as mensagens acima e mostre para o Claude."
  exit 1
fi
