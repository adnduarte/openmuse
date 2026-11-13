# Evidencia — W2 browser worker: ref/snapshotId

Fecha: 2026-11-13. Repo del browser worker: `adnduarte/openmuse` (fork de
`CopilotKit/openmuse`), servicio `apps/worker`. Rama:
`fix/w2-browser-ref-2026-11-13`, apilada sobre
`feat/worker-snapshot-2026-11-12` (H4, PR abierto `adnduarte/openmuse#1`).

## Qué se cableó

El worker ya entregaba snapshots H4 (`GET /sessions/:id/snapshot`) con refs
opacos, pero `POST /sessions/:id/input` solo aceptaba click por coordenadas,
texto, tecla y scroll. W2 hace que el worker resuelva `ref` + `snapshotId` a un
selector interno `[data-juxa-ref="…"]` y lo use para click/text/key, respetando
el contrato `snapshot-dom` de `juxa-harness` W1 (PR #9508).

| Antes | Ahora |
|---|---|
| `input` con `ref`/`snapshotId` no tenía backend (el adaptador del harness respondía 501). | El worker acepta `{type:"click",ref,snapshotId}`, `{type:"text",ref,snapshotId,text}`, `{type:"key",ref,snapshotId,key}`. |
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
| Fail-closed | Snapshot vencido/ausente → `409 SNAPSHOT_STALE`; ref ajeno → `409 REF_NOT_FOUND`; par incompleto o ref inválido → `400 INVALID_INPUT`; coincidencia múltiple → `409 REF_AMBIGUOUS`. |
| Sin selectores del llamador | El único selector se construye desde el ref validado; no se aceptan CSS, scripts ni evaluación externa. |
| Topes 200/200/300/48 KiB | Se conservan de H4; elementos que no se pueden marcar se omiten y `truncated=true`. |

Nota: W1 usa FNV-1a y H4 usa SHA-256 truncado. El contrato de paridad es el
wire (`ref` opaco de 16 hex, `data-juxa-ref`, `snapshotId` y fail-closed), no el
algoritmo interno del hash.

## Verificación

| Archivo | Comando | Resultado |
|---|---|---|
| `01-typecheck.txt` | `npm run typecheck` (apps/worker) | exit 0 |
| `02-unit-tests.txt` | `npm run test:snapshot` | 15/15 PASS |
| `03-lifecycle.txt` | `PLAYWRIGHT_BROWSERS_PATH=… node --experimental-strip-types --test tests/lifecycle.test.ts` | 3/3 PASS (Chromium real) |
| `04-git-diff-stat.txt` | `git diff --cached --stat -- apps/worker` | 9 archivos, +627/−39 |
| `05-contract-grep.txt` | grep de constantes y códigos | — |

La prueba de lifecycle W2 cubre:

1. `ref` sin `snapshotId` y `snapshotId` sin `ref` → `INVALID_INPUT`.
2. Ref con forma de ruta (`../etc/passwd`) → `INVALID_INPUT`.
3. Snapshot anterior → `SNAPSHOT_STALE`; ref ajeno → `REF_NOT_FOUND`.
4. Click por ref navega de verdad (`Next page` → `Another fixture page.`).
5. Tras navegar, el snapshot anterior ya no sirve.
6. `text` por ref actualiza el campo y el siguiente snapshot observa el valor.
7. `worker-checks.ts` (contrato compartido con el test Docker) incluye los
   mismos casos de click/text por ref y los códigos de error.

## Límites honestos

- **Sin deploy.** El worker de staging sigue en H4 y no acepta refs todavía;
  este cambio es código local + tests. No hay `PASS live` de refs.
- **Apilado sobre H4.** El PR de W2 no puede integrarse antes del PR H4
  (`feat/worker-snapshot-2026-11-12`), porque depende del snapshot con refs.
- **El adaptador del harness sigue devolviendo 501.** `juxa-harness`
  (`server/agent-computer.mjs`) rechaza `click`/`type` con `ref` antes de
  llamar al worker. Para el cableado end-to-end falta un PR del harness que
  reenvíe `ref`/`snapshotId` al worker desplegado. Este carril solo desbloquea
  el lado worker, como se pidió.
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
