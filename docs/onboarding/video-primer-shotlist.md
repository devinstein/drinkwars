# Drink Wars video primer · shot list (draft, 11-16)

Shots for `video-primer-script.md`, keyed to the in-app guided round. Each row's frame comes from `web/scripts/primer-shots.mjs`, which walks **Learn the game** at 1440 × 900 and saves `NN-<step>-light.png` (add `DARK=1` for dark) to `.scratch/onboarding/shots/`. The frames are reference stills for the edit: record the real screen for the video, with the same highlight ring and the coach card hidden. Timings are the script's estimates.

| # | Time | Screen (frame) | On screen | Narration starts |
|---|---|---|---|---|
| 1 | 0:00 | Lobby (`01-lobby`) | The six cards; **Learn the game** first | "Drink Wars is a strategy game…" |
| 2 | 0:20 | Decide, round 1 (`02-welcome`) | The whole Decide screen of the practice game | "A round is one quarter of a year…" |
| 3 | 0:38 | Instrument bar (`03-hud`) | Round · cash · capacity · rank, ringed | "Across the top is the instrument bar…" |
| 4 | 1:00 | Boardroom (`04-boardroom`) | The four officers; open one "details" for a beat | "On the right of Decide is the Boardroom…" |
| 5 | 1:38 | CMO line (`05-market`) | Market · shoppers; open the CMO popover (shelf prices, value stick) | "Start with the CMO…" |
| 6 | 2:10 | Production lines (`06-prices`) | Price boxes and "+$ / drink" under each | "The production lines are where prices go…" |
| 7 | 2:29 | Tanks & Allocation (`07-tanks`) | Type an order; the card's units and "next quarter" update; drag the allocation bar | "Tanks set how many drinks you can brew…" |
| 8 | 3:00 | Build the Brewery (`08-build`) | The six sliders | "Below that is Build the Brewery…" |
| 9 | 3:25 | Financing (`09-finance`) | Draw · repay · equity · dividend, with their limits | "The Financing card is money in and money out…" |
| 10 | 3:38 | Cash & credit (`10-cash`) | The rail's top block | "Those limits are on the right…" |
| 11 | 4:00 | Paid from sales (`11-running`) | Projected cash; operating costs; the interest line; break-even | "Under that is projected cash…" |
| 12 | 4:30 | Brew & Resolve (`12-brew`) | The button; cut to the Before-you-submit check on an over-spent plan (a $1.2M tank order) | "When the plan is set, you press Brew…" |
| 13 | 5:12 | Results page (`13-results`) | Finish, net income, cash, what hit the market | "The results page comes first…" |
| 14 | 5:26 | Statements & Ratios (`14-statements`) | Income statement, scroll to the balance sheet | "Review holds the detail…" |
| 15 | 5:40 | Value stick (`15-value`, `15b-value-round2`) | Round 1 sticks; then round 2 with "Since the quarter before" | "The Value stick tab shows…" |
| 16 | 6:15 | The Dispatch (`16-dispatch`) | The front page and standings | "The Dispatch is the round's news…" |
| 17 | 6:30 | Lobby (`01-lobby`) | **Learn the game** card, ringed | "That is one round…" |

## Notes for the recording

- **Shot 12's check** needs a plan the round can't fund: order $1.2M of tanks in round 1, press Brew, hold on the check, then **Go back**. Record it as its own take; the practice game's default plan raises no check.
- **Class-game insert (section 7, optional):** a team seat's rail after Submit (the "Sent … It runs when the round locks" receipt). It needs a class game with two seats; skip it if the take runs long.
- **Accessibility:** captions (`video-primer.vtt`) and a transcript (`video-primer-transcript.txt`) ship with the video; re-time the captions after recording (`node docs/onboarding/build-captions.mjs` rebuilds them from the script). Keep the cursor slow and the zooms on the panel being described.
- **No student data:** record the practice game only. Its rival names are made up at random for each practice game; no class names, teams or results appear.
