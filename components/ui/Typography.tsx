import { Text, type TextProps } from 'react-native';
import { cn } from '@/utils/cn';

function make(base: string) {
  return function TypographyText({ className, ...props }: TextProps) {
    return <Text className={cn(base, className)} {...props} />;
  };
}

/** 34px/800 Manrope — page hero titles ("Tontine des Copines"). */
export const DisplayText = make('font-manrope-extrabold text-[34px] leading-[42px] tracking-[-0.6px] text-text-primary');
/** 24px/700 Manrope — section headlines. */
export const HeadlineText = make('font-manrope-bold text-2xl leading-[30px] tracking-[-0.2px] text-text-primary');
/** 18px/600 Manrope — card/section titles. */
export const SectionTitleText = make('font-manrope-semibold text-lg leading-6 text-text-primary');
/** 17px/400 Inter — primary reading copy. */
export const BodyLgText = make('font-inter text-[17px] leading-6 text-text-primary');
/** 15px/400 Inter — secondary copy, descriptions. */
export const BodyMdText = make('font-inter text-[15px] leading-[21px] text-text-secondary');
/** 13px/500 Inter — labels, timestamps, captions. */
export const LabelText = make('font-inter-medium text-[13px] leading-[18px] text-text-secondary');
/** 16px/600 Inter — button labels. */
export const ButtonLabelText = make('font-inter-semibold text-base leading-5');
