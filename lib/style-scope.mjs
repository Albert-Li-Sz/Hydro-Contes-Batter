import postcss from 'postcss';

// Keep XCPCIO's UnoCSS resets inside the board, away from Hydro's shell.
export function scopeBoardCss(css, from) {
    const root = postcss.parse(css, { from });
    const animations = new Map();
    root.walkAtRules(/keyframes$/, (rule) => {
        const name = rule.params.trim();
        animations.set(name, `xcpcio-${name}`);
        rule.params = animations.get(name);
    });
    root.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/, (declaration) => {
        declaration.value = declaration.value.replace(/[\w-]+/g, (word) => animations.get(word) || word);
    });
    root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
        rule.selectors = rule.selectors.map((original) => {
            const selector = original.replace(/(^|[\s,])(?:html)?\.dark(?=[\s>+~]|$)/g, '$1.theme--dark');
            if (['html', 'body', ':root', ':host', '#app'].includes(selector)) return ':where(#app)';
            if (selector === '.theme--dark') return ':where(.theme--dark) #app';
            // The two libraries append popovers/toasts to body. Their unique
            // class namespaces need to work outside the board root as well.
            if (/\.v-(?:popper|toast)/.test(selector)) return selector;
            if (selector.startsWith('.theme--dark ')) return selector.replace('.theme--dark ', '.theme--dark :where(#app) ');
            if (selector.startsWith('#app ')) return selector;
            // A plain prefix also preserves pseudo-elements, which :is() does
            // not accept (icons and generated content depend on them).
            return `:where(#app) ${selector}`;
        });
    });
    return root.toString();
}
