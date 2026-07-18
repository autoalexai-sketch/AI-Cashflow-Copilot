# ARCHITECTURE — SplitBooks (AI Cashflow Copilot)

> Обновлено: 2026-07-18. Этот файл — source of truth по инфраструктуре.
> При изменении хостинга, DNS или процесса деплоя — обновить здесь.

## Инфраструктура (актуально)

| Компонент | Значение |
|---|---|
| Хостинг | Cloudflare Pages, проект `ai-cashflow-copilot-v2` (direct upload) |
| Аккаунт Cloudflare | autoalexai@gmail.com, account id `33629195b33c5fd6d97096644551e0dd` |
| Домены | splitbooks.pl (основной, canonical), splitbooks.eu, www.splitbooks.pl |
| DNS | Cloudflare (NS: kayleigh / kianchau.ns.cloudflare.com), записи: CNAME apex и www → `ai-cashflow-copilot-v2.pages.dev`, Proxied |
| Регистратор | home.pl (аккаунт luxeclean27@gmail.com); DNSSEC выключен |
| Backend | Supabase (`bgbcyncpdfnsrhvunzkv.supabase.co`) — auth, DB, realtime |
| Капча | Cloudflare Turnstile |
| Repo | github.com/autoalexai-sketch/AI-Cashflow-Copilot, ветка `main` = прод |

## Деплой

**Source of truth — GitHub `main`.** Прод обновляется только из репозитория.

- **Автодеплой**: push в `main` → GitHub Actions (`.github/workflows/deploy.yml`) → wrangler → Cloudflare Pages. Требует секрет `CLOUDFLARE_API_TOKEN` в GitHub repo secrets (токен с правом Cloudflare Pages — Edit).
- **Ручной fallback**: Cloudflare Dash → Workers & Pages → ai-cashflow-copilot-v2 → Create deployment → загрузить zip/папку (env: Production).
- Бандл = корень репо без `.git`, `.github`, `*.md`, `*.sql`. `index.html` и `splitbooks.html` — идентичные копии приложения.
- Git-интеграцию Pages подключить нельзя: проект создан как direct upload (ограничение Cloudflare). Поэтому CI через wrangler.

## История

- **2026-07-06…14** — хостинг Netlify (team luxeclean27), DNS Netlify/NS1.
- **2026-07-17** — Netlify исчерпал кредиты (деплои заблокированы, сайт под угрозой отключения). Миграция на Cloudflare Pages: свежий деплой, домены переключены, NS возвращены на Cloudflare через панель home.pl. Netlify больше не используется.
- **2026-07-18** — обнаружено, что в репо не была закоммичена прод-версия от 2026-07-14 (создавалась в Cowork-сессии, файл `splitbooks_preview.html`). Версия задеплоена и закоммичена (`067d8ae`). Добавлен CI-автодеплой.
- Примечание: смена NS в home.pl для .pl проходит через промежуточное состояние (делегирование на dns*.home.pl с пустой зоной, до ~1 ч) — это нормально, не чинить.

## Правила (усвоенные уроки)

1. **Всё, что сделано в Cowork-сессии, в тот же день коммитится в GitHub.** Прод никогда не должен опережать репозиторий: следующий автодеплой из отставшего main откатит сайт.
2. Деплой = `git push` в main. Никаких правок «только на хостинге».
3. Секреты (API-токены) — только в GitHub Secrets / Cloudflare, никогда в коде и чатах.
