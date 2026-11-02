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
| Lisa | 1111 | teamleider (ziet alles) |
| Kevin | 2222 | medewerker |
| Mark | 3333 | medewerker |
| Sanne | 4444 | beheerder |

Er staan al terugbelverzoeken (te laat, binnenkort, in de pool, afgerond) en taken (gedeeld, "iedereen vinkt af", gearchiveerd).

- Wat je aanpast blijft bewaard **in jouw browser**. Collega's zien hun eigen kopie, dus wijzigingen worden niet gedeeld.
- **Demo resetten** zet alles terug naar de nepgegevens van het begin.
- Inloggen geldt per tabblad. Open bijvoorbeeld een tweede venster om als Lisa en Kevin tegelijk te kijken (na een verversing zie je elkaars wijzigingen).

## Bestanden

- `index.html` · startpagina
- `app.js` · de schermen (dezelfde als in de echte versie)
- `styles.css` · de vormgeving
- `demo-api.js` · doet alsof er een server is en bewaart de nepgegevens in de browser
