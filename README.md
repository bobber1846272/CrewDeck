# Terugbelsysteem · DEMO

Testversie van het terugbelsysteem voor TheNextGroep BV, met **alleen nepgegevens**.
Hij draait helemaal in de browser, dus hij werkt op GitHub Pages zonder server.

> Zet hier **geen echte klantgegevens** in. Deze versie is alleen om uit te proberen.
> Voor echt gebruik is er de lokale versie met server (`terugbelsysteem.zip`).

## Online zetten op GitHub Pages

1. Maak op GitHub een nieuwe repository, bijvoorbeeld `terugbelsysteem-demo`.
2. Upload alle bestanden uit deze map (Add file → Upload files).
3. Ga naar **Settings → Pages**, kies bij *Source* **Deploy from a branch**, branch `main`, map `/ (root)`, en klik op Save.
4. Na een minuutje staat hij op `https://<jouw-gebruikersnaam>.github.io/terugbelsysteem-demo/`.

## Testen

Bovenaan staat een gele demobalk: klik op een naam om meteen als die persoon in te loggen.

| Naam | Code | Rol |
|---|---|---|
| Admin | 1234 | hoofdbeheerder, alle rechten |
| Lisa | 1111 | teamleider: teambord, cijfers, logboek |
| Kevin | 2222 | medewerker |
| Mark | 3333 | medewerker |
| Sanne | 4444 | beheerder: mag ook verwijderen |

Er staan al terugbelverzoeken (te laat, binnenkort, in de pool, afgerond), ruim een maand aan afgeronde verzoeken voor de cijfers, taken (gedeeld, "iedereen vinkt af", terugkerend, gearchiveerd) en een gevuld logboek.

**Leuk om te proberen**
- Als Kevin: een snelnotitie kiezen en op "Niet bereikt" klikken, een verzoek bewerken, of bovenaan zoeken op "regenboog" of "4829".
- Nieuw verzoek met ordernummer `482913`: je krijgt de melding dat er al een open verzoek voor die klant is.
- Als Lisa: op het **Teambord** een verzoek naar een andere kolom slepen, en bij **Cijfers** en **Logboek** kijken.
- **Meldingen:** open twee tabbladen, log in het ene in als Kevin en in het andere als Lisa. Sleep als Lisa iets naar Kevin, en binnen 20 seconden krijgt Kevin een geluidje en een melding.

- Wat je aanpast blijft bewaard **in jouw browser**. Collega's zien hun eigen kopie, dus wijzigingen worden niet gedeeld.
- **Demo resetten** zet alles terug naar de nepgegevens van het begin.
- Inloggen geldt per tabblad. Tabbladen in dezelfde browser delen wel de gegevens.

## Bestanden

- `index.html` · startpagina
- `app.js` · de schermen (dezelfde als in de echte versie)
- `core.js` · alle regels van het systeem (dezelfde als in de echte versie)
- `styles.css` · de vormgeving
- `demo-api.js` · doet alsof er een server is en bewaart de nepgegevens in de browser
