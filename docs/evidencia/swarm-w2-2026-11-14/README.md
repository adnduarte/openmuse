# Evidencia — W2 browser worker: resolución `ref` → selector

**Fecha:** 2026-11-14. **Repo del browser worker:** `adnduarte/openmuse`
(fork de `CopilotKit/openmuse`), servicio `apps/worker`.
**Rama:** `fix/w2-browser-ref-2026-11-14`, apilada sobre
`feat/worker-snapshot-2026-11-12` (H4, PR abierto `adnduarte/openmuse#1`).
**PR de este carril:** https://github.com/adnduarte/openmuse/pull/3
(base H4, no `main`).

## Qué se cableó

El worker H4 ya entregaba snapshots (`GET /sessions/:id/snapshot`) con refs
opacos y `snapshotId`, pero `POST /sessions/:id/input` solo aceptaba click por
coordenadas, texto, tecla y scroll. Este carril hace que el worker resuelva
`ref` + `snapshotId` a un selector interno `[data-juxa-ref="…"]` y lo use para
`click`/`text`/`key`, respetando el contrato `snapshot-dom` de `juxa-harness`
W1 (`src/core/agent-computer/snapshot-dom.ts`, PR #9508).

| Antes | Ahora |
|---|---|
| `input` con `ref`/`snapshotId` no tenía backend; el adaptador del harness respondía 501. | El worker acepta `{type:"click",ref,snapshotId}`, `{type:"text",ref,snapshotId,text|texto}` y `{type:"key",ref,snapshotId,key|tecla}`. |
| El snapshot H4 no marcaba el DOM. | Al tomar el snapshot, el worker marca cada elemento usable con `data-juxa-ref` vía CDP y solo publica refs que resuelven a exactamente un elemento de la página superior. |
| No había verificación de vigencia. | Solo el `snapshotId` más reciente por sesión es válido; navegar o cerrar invalida los refs. |

Archivos:

- `apps/worker/src/snapshot-refs.ts` — validación y resolución fail-closed
  (`data-juxa-ref`, `^e[0-9a-f]{16}$`, `snapshotId` entero ≥ 0).
- `apps/worker/src/snapshot.ts` — `buildSnapshotWithTargets` conserva
  `backendDOMNodeId` solo para uso interno (nunca sale en el JSON).
- `apps/worker/src/browser.ts` — marcado CDP, acción por ref, invalidación por
  navegación y estado de snapshot por sesión.
- `apps/worker/README.md` — contrato de `input` y códigos de error.

## Contrato W1 respetado

| Elemento W1 | Implementación worker |
|---|---|
| Atributo `data-juxa-ref` | `ATRIBUTO_REF_DOM = "data-juxa-ref"`. |
| Ref opaco `e` + 16 hex | `PATRON_REF_SNAPSHOT = /^e[0-9a-f]{16}$/`; SHA-256 truncado del árbol AX (H4), nunca rol/nombre en el wire. |
| Resolución solo contra el snapshot que produjo el ref | Estado por sesión `{snapshotId, refs}`; se reemplaza en cada snapshot y se borra al navegar/cerrar. |
| Fail-closed | Snapshot vencido/ausente → `409 SNAPSHOT_STALE`; ref ajeno → `409 REF_NOT_FOUND`; par incompleto o ref inválido → `400 INVALID_INPUT`; coincidencia múltiple → `409 REF_AMBIGUOUS`; elemento no accionable → `409 REF_NOT_ACTIONABLE`. |
| Sin selectores del llamador | El único selector se construye desde el ref validado; no se aceptan CSS, scripts ni evaluación externa. |
| Topes 200/200/300/48 KiB | Se conservan de H4; elementos que no se pueden marcar se omiten y `truncated=true`. |

Nota: W1 usa FNV-1a y H4 usa SHA-256 truncado. El contrato de paridad es el
wire (`ref` opaco de 16 hex, `data-juxa-ref`, `snapshotId` y fail-closed), no el
algoritmo interno del hash. Cambiar el hash rompería la estabilidad de refs de
H4 sin aportar nada al contrato.

## Verificación (local, sin deploy)

| Archivo | Comando | Resultado |
|---|---|---|
| `01-typecheck.txt` | `npm --prefix apps/worker run typecheck` | exit 0 |
| `02-unit-tests.txt` | `npm --prefix apps/worker run test:snapshot` | 15/15 PASS |
| `03-lifecycle.txt` | `PLAYWRIGHT_BROWSERS_PATH=… node --experimental-strip-types --test apps/worker/tests/lifecycle.test.ts` | 3/3 PASS (Chromium real, Playwright 1.62.1) |
| `04-git-diff-stat.txt` | `git diff --cached --stat -- apps/worker` | 9 archivos, +668/−39 |
| `05-contract-grep.txt` | grep de constantes y códigos | — |
| `06-harness-501.txt` | gate 501 del adaptador del harness | — |
| `07-verificacion-2026-11-15.txt` | re-verificación local del 2026-11-15 (typecheck, 15/15, 3/3) | exit 0 / 15 PASS / 3 PASS |
| `08-verificacion-2026-11-15-sesion.txt` | re-verificación independiente de cierre del carril (mismo HEAD `13c4291`, PR #3 OPEN/MERGEABLE) | exit 0 / 15 PASS / 3 PASS |

La prueba de lifecycle W2 cubre:

1. `ref` sin `snapshotId` y `snapshotId` sin `ref` → `INVALID_INPUT`.
2. Ref con forma de ruta (`../etc/passwd`) → `INVALID_INPUT`.
3. Snapshot anterior → `SNAPSHOT_STALE`; ref ajeno → `REF_NOT_FOUND`.
4. Click por ref navega de verdad (`Next page` → `Another fixture page.`).
5. Tras navegar, el snapshot anterior ya no sirve.
6. `text` por ref actualiza el campo (alias `texto`) y el siguiente snapshot
   observa el valor.
7. `key` por ref (alias `tecla`) resuelve el elemento; teclas no permitidas,
   `scroll` con ref y click con ref + coordenadas → `INVALID_INPUT`.
8. `worker-checks.ts` (contrato compartido con el test Docker) incluye los
   mismos casos de click/text por ref y los códigos de error por HTTP.

## Límites honestos

- **Sin deploy.** El worker de staging sigue en H4 y no acepta refs todavía;
  este cambio es código local + tests. No hay `PASS live` de refs.
- **Apilado sobre H4.** Este PR no puede integrarse antes del PR H4
  (`feat/worker-snapshot-2026-11-12`), porque depende del snapshot con refs.
- **El adaptador del harness sigue devolviendo 501.** El 501 observado no nace
  en el worker: `juxa-harness` (`server/agent-computer.mjs`, commit `067da4a55`)
  rechaza `click`/`type` con `ref` en las líneas 2636–2637 y 2651–2652 antes de
  llamar al worker, y en `key` descarta `ref`/`snapshotId` sin reenviarlos
  (líneas 2655–2669). Para el cableado end-to-end falta un PR del harness que
  reenvíe `ref`/`snapshotId` al `input` del worker desplegado. Este carril solo
  desbloquea el lado worker, como se pidió.
- **Estado de snapshot en memoria.** Un reinicio del worker invalida refs y
  reinicia `snapshotId`; el cliente debe pedir un snapshot nuevo.
- **Solo página superior.** Elementos dentro de iframes no son direccionables
  por `page.locator`; se omiten del snapshot y se marca `truncated=true`.
- **El atributo es visible para la página.** El ref es opaco, no un secreto.
  Si la página duplica el atributo, la acción se rechaza por ambigüedad
  (`REF_AMBIGUOUS`); el worker nunca elige un elemento entre varios.
- **`text` por ref usa `fill`.** Reemplaza el contenido del campo (a diferencia
  del `insertText` legacy sin ref); `enter`/`enviar` presiona Enter después.
- **Docker no ejecutado.** `npm run test:docker` no se corrió; el lifecycle
  local usa Chromium real y cubre la misma API. El test Docker compartido
  (`worker-checks.ts`) quedó actualizado para correrlo en CI/infra.

## Relación con el carril 2026-11-13

El 2026-11-13 se abrió el PR #2 con la primera versión de este cambio. Este
carril re-ejecuta la verificación sobre una rama nueva, añade los alias
`texto`/`tecla` (nombres del wire del harness) y pruebas de los verbos que no
aceptan ref. Si ambos PR están abiertos, este los supersede.
