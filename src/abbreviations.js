/*!
 * English and Spanish abbreviation lists from string-segmenter 1.3.0.
 * Copyright Matthew Pietz. ISC license.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
export const abbreviations = {
    en: new Set(`a.d. a.m. a.s.a.p. adm. ala. apr. ariz. ark. aug. b.c. b.c.e. b.y.o.b. bros.
        calif. co. col. colo. conn. corp. d.c. d.i.y. dec. del. dr. e.g. e.t.a. etc. feb. fla.
        ga. gen. gov. i.e. ill. inc. ind. j.d. jan. jr. jul. jun. kan. kans. ky. la. lt. ltd.
        m.d. mar. mass. may. md. messrs. mich. minn. miss. mo. mont. mr. mrs. ms. mt. n.c. n.d.
        n.h. n.j. n.m. n.y. neb. nebr. nev. nov. oct. okla. ore. p.m. p.s. pa. ph.d. prof.
        r.s.v.p. rep. rev. sen. sep. sept. sr. st. tenn. va. vs. wash. wis.`.split(/\s+/)),
    es: new Set(`adj. adm. ant. apdo. aprox. arq. av. c. cap. dep. dir. dpto. dr. dra. edif.
        etc. fig. gral. ing. lic. min. máx. mín. núm. prof. prox. pto. pág. rev. sig. sr. sra.
        tel. trad. ult. vol.`.split(/\s+/))
};
