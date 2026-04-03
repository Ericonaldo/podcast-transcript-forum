# Deploy SOP

## Canonical sequence

```bash
git add <files>
git commit -m "feat/fix: ..."
git fetch origin main
git rebase origin/main
git push origin <worktree-branch>:main

cd /home/mhliu/podcast-transcript-forum
git pull origin main
cd client && rm -rf dist && npx vite build

rsync -avz --delete /home/mhliu/podcast-transcript-forum/client/dist/ newserver:/home/prod/podcast-forum/client/dist/
ssh newserver "cd /home/prod/podcast-forum && git pull origin main"
ssh newserver "kill \$(ssh newserver 'ss -tlnp | grep 4010 | grep -oP \"pid=\\d+\" | grep -oP \"\\d+\"') 2>/dev/null"
ssh newserver "cd /home/prod/podcast-forum && nohup node server/src/index.js > server.log 2>&1 & echo PID=\$!"
sleep 2 && ssh newserver "curl -s -o /dev/null -w '%{http_code}' http://localhost:4010/"
```

## Verify

- `npm test` locally before deployment.
- Check HTTP `200` from `http://localhost:4010/` on the server.
- If UI behavior changed, confirm in browser after deploy rather than assuming build success means runtime success.
