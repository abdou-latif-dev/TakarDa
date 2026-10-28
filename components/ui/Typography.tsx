import { Text, type TextProps } from 'react-native';
import { cn } from '@/utils/cn';

// Une classe de couleur passée par l'appelant remplace la couleur par défaut du composant. Sans cela, les deux
// classes restent et c'est l'ordre du CSS généré (pas l'intention) qui décide laquelle s'applique.
const COLOR_CLASS = /(^|\s)text-(text-(primary|secondary|muted)|primary(-dark|-light|-soft)?|white|black|error|success|warning|info)(?=\s|$)/;

const SIZE_CLASS = /(^|\s)text-(\[\d+px\]|xs|sm|base|lg|xl|2xl|3xl)(?=\s|$)/;

function make(base: string) {
  return function TypographyText({ className, ...props }: TextProps) {
    let resolvedBase = base;
    if (className && COLOR_CLASS.test(className)) resolvedBase = resolvedBase.replace(COLOR_CLASS, '');
    if (className && SIZE_CLASS.test(className)) resolvedBase = resolvedBase.replace(SIZE_CLASS, ''); // idem pour la taille de police
    return <Text className={cn(resolvedBase, className)} {...props} />;
  };
}

/** 34px/800 Manrope — page hero titles ("Tontine des Copines"). */
export const DisplayText = make('font-manrope-extrabold text-[34px] leading-[42px] tracking-[-0.6px] text-text-primary');
/** 24px/700 Manrope — section headlines. */
export const HeadlineText = make('font-manrope-bold text-2xl leading-[30px] tracking-[-0.2px] text-text-primary');
/** 18px/600 Manrope — card/section titles. */
export const SectionTitleText = make('font-manrope-bold text-lg leading-6 text-text-primary');
/** 16px/400 — primary reading copy (Manrope, via l'alias font-inter). */
export const BodyLgText = make('font-inter text-base leading-6 text-text-primary');
/** 14px/400 — secondary copy, descriptions. */
export const BodyMdText = make('font-inter text-sm leading-5 text-text-secondary');
/** 13px/500 Inter — labels, timestamps, captions. */
export const LabelText = make('font-inter-medium text-[13px] leading-[18px] text-text-secondary');
/** 16px/600 Inter — button labels. */
export const ButtonLabelText = make('font-inter-semibold text-base leading-5');
