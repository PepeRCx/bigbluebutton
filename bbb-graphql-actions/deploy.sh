#!/usr/bin/env bash

cd "$(dirname "$0")"

verify_ws_artifact() {
    local label="$1"
    local file_path="$2"

    if [[ ! -f "$file_path" ]] ; then
        echo "ERROR: $label artifact not found at $file_path"
        exit 1
    fi

    if ! grep -Fq "server.on('upgrade'" "$file_path" ; then
        echo "ERROR: $label artifact is missing the Express 5 WebSocket upgrade handler"
        exit 1
    fi

    if ! grep -Fq "/tim-ai/stt/ws" "$file_path" ; then
        echo "ERROR: $label artifact is missing the Tim AI STT WebSocket route"
        exit 1
    fi

    if ! grep -Fq "TimAI-STTHandler" "$file_path" ; then
        echo "ERROR: $label artifact is missing the Tim AI STT handler wiring"
        exit 1
    fi

    if grep -Fq "path: '/tim-ai/stt/ws'" "$file_path" ; then
        echo "ERROR: $label artifact still contains the stale path-based Tim AI STT WebSocket registration"
        exit 1
    fi
}

for var in "$@"
do
    if [[ $var == --reset ]] ; then
    	echo "Performing a full reset..."
      sudo rm -rf node_modules
    fi
done

if [ ! -d ./node_modules ] ; then
  sudo npm ci --no-progress
fi

sudo npm run build
verify_ws_artifact "built" "dist/index.js"

# handle renaming circa dec 2023
if [[ -d /usr/local/bigbluebutton/bbb-graphql-actions-adapter-server ]] ; then
    sudo systemctl stop bbb-graphql-actions-adapter-server
    sudo rm -f /usr/lib/systemd/system/bbb-graphql-actions-adapter-server.service
    sudo systemctl daemon-reload
    sudo rm -rf /usr/local/bigbluebutton/bbb-graphql-actions-adapter-server
fi

sudo mv -f dist/index.js dist/bbb-graphql-actions.js
sudo cp -rf dist/* /usr/local/bigbluebutton/bbb-graphql-actions
verify_ws_artifact "deployed" "/usr/local/bigbluebutton/bbb-graphql-actions/bbb-graphql-actions.js"
sudo systemctl restart bbb-graphql-actions
echo ''
echo ''
echo '----------------'
echo 'bbb-graphql-actions updated'
