# Deployment

This app has two deployable pieces:

- The Next.js website in `app`, `components`, and `lib`.
- The PartyKit realtime buzzer server in `realtime-server`.

## Recommended setup

1. Deploy the website to Vercel or Render.
2. Deploy the realtime buzzer server with PartyKit:

```sh
npm run party:deploy
```

3. Set `NEXT_PUBLIC_PARTYKIT_HOST` on the website deployment to the deployed PartyKit host.

## Notes

- Two hosts clicking "Host a Quiz" create separate rooms because each host gets a generated room code.
- Anyone with a host room URL can currently connect as host for that room. Add host authentication before using this for public, serious events.
- Shared mode is same-device play. The room code still exists internally because the realtime server stores every game by room.
