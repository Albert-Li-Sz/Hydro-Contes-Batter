import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { scopeBoardCss } from '../lib/style-scope.mjs';

describe('embedding XCPCIO in the Hydro theme', () => {
    it('contains global resets and ordinary component rules in the board', () => {
        const output = scopeBoardCss('html,body,#app{margin:0}*,:before{box-sizing:border-box}.nav a{color:red}');
        expect(output).not.toMatch(/(?:^|})html[,{]/);
        expect(output).toContain(':where(#app) .nav a');
        expect(output).toContain(':where(#app) *');
    });
    it('uses the host Hydro theme, including dark selectors with ancestors outside the board', () => {
        const output = scopeBoardCss('html.dark{--background:black}.dark td[data-v-x]{color:white}');
        expect(output).toContain(':where(.theme--dark) #app');
        expect(output).toContain('.theme--dark :where(#app) td[data-v-x]');
    });
    it('preserves selector lists inside functions and media queries', () => {
        const output = scopeBoardCss('@media(max-width:600px){.prose :where(h1,h2):not(.skip){color:red}}');
        const root = postcss.parse(output);
        expect(output).toContain(':where(#app) .prose :where(h1,h2):not(.skip)');
        expect(root.first?.type).toBe('atrule');
    });
    it('namespaces animations without turning keyframe steps into selectors', () => {
        const output = scopeBoardCss('@keyframes fadeIn{from{opacity:0}to{opacity:1}}.x{animation:fadeIn .2s ease-in}');
        expect(output).toContain('@keyframes xcpcio-fadeIn{from{opacity:0}to{opacity:1}}');
        expect(output).toContain('animation:xcpcio-fadeIn .2s ease-in');
    });
    it('preserves popovers and toasts rendered under body', () => {
        const output = scopeBoardCss('.v-popper__inner{color:white}.v-toast{position:fixed}.button{color:blue}');
        expect(output).toContain('.v-popper__inner{color:white}');
        expect(output).toContain('.v-toast{position:fixed}');
        expect(output).toContain(':where(#app) .button');
    });
    it('keeps generated-content pseudo-elements valid', () => {
        const output = scopeBoardCss('.icon:before{content:"x"}.dark .icon::after{color:white}');
        expect(output).toContain(':where(#app) .icon:before');
        expect(output).toContain('.theme--dark :where(#app) .icon::after');
        expect(output).not.toContain(':is(');
    });
});
