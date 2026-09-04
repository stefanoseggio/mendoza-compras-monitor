import type { CheerioAPI } from 'cheerio';

import type { FormFields } from '../types.js';

// Same pattern proven necessary for cordoba-compras-monitor's ASP.NET
// WebForms postback flow: replicate exactly what a real browser submits -
// every non-button input's current value, every select's selected option,
// and ONLY checkboxes/radios that are actually checked. This form has far
// fewer checkboxes than Cordoba's (none observed unchecked-by-default that
// affect this flow), but the same discipline applies regardless - sending
// a stray checked=value for something the user never checked is exactly
// the class of bug that silently corrupted Cordoba's postback state.
export function extractFormFields($: CheerioAPI): FormFields {
    const fields: FormFields = {};

    $('input').each((_i, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;
        const type = ($el.attr('type') ?? 'text').toLowerCase();

        if (type === 'checkbox' || type === 'radio') {
            if ($el.attr('checked') === undefined) return;
            fields[name] = $el.attr('value') ?? 'on';
            return;
        }
        if (type === 'submit' || type === 'image' || type === 'button' || type === 'reset') return;

        fields[name] = $el.attr('value') ?? '';
    });

    $('select').each((_i, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;
        const selected = $el.find('option[selected]').first();
        const chosen = selected.length > 0 ? selected : $el.find('option').first();
        fields[name] = chosen.attr('value') ?? '';
    });

    $('textarea').each((_i, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;
        fields[name] = $el.text();
    });

    return fields;
}

export function buildPostbackPayload($: CheerioAPI, eventTarget: string, eventArgument = ''): FormFields {
    return {
        ...extractFormFields($),
        __EVENTTARGET: eventTarget,
        __EVENTARGUMENT: eventArgument,
    };
}
