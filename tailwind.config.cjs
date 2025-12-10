const { fontFamily } = require('tailwindcss/defaultTheme')
const colors = require('tailwindcss/colors')

/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: ['./src/**/*.{ts,tsx}'],

    // corePlugins: {
    //     preflight: false
    // },
    theme: {
        container: {
            center: true,
            padding: '2rem',
            screens: {
                '2xl': '1400px'
            }
        },
        extend: {
            screens: {
                '3xl': '1700px',
                '2k': '1900px',
                'sm-screen': '1050px'
            },
            fontFamily: {
                sans: ['var(--font-geist-sans)', ...fontFamily.sans],
                mono: ['var(--font-geist-mono)', ...fontFamily.mono]
            },
            colors: {
                'text-secondary': '#667085',
                'hz-primary': '#4376fd',
                'box-background': '#f3f5fa',
                'emphasize-background': '#fafbff',
                ignore: '#5e6772',
                hover: '#060607',
                'hover-bg': '#f3f5fc',
                disabled: '#c5cddf',
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))'
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))'
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
                    foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)'
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))'
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))'
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))'
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))'
                },
                sidebar: {
                    DEFAULT: 'hsl(var(--sidebar-background))',
                    foreground: 'hsl(var(--sidebar-foreground))',
                    primary: 'hsl(var(--sidebar-primary))',
                    'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
                    accent: 'hsl(var(--sidebar-accent))',
                    'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
                    border: 'hsl(var(--sidebar-border))',
                    ring: 'hsl(var(--sidebar-ring))'
                }
            },
            gradientColorStops: {
                'search-background':
                    'linear-gradient(0deg, #f3f5fc, #f3f5fc), linear-gradient(196.75deg, rgba(248, 250, 255, .7) 38.16%, rgba(243, 245, 252, .7) 96.85%)',
                'primary-background':
                    'linear-gradient(0deg, #f3f5fc, #f3f5fc), linear-gradient(196.75deg, rgba(248, 250, 255, .7) 38.16%, rgba(243, 245, 252, .7) 96.85%)',
                'gradient-background':
                    'linear-gradient(90deg,rgb(239, 242, 247) 0%,7.60286%,rgb(237, 240, 249) 15.2057%,20.7513%,rgb(235, 239, 248) 26.297%,27.6386%,rgb(235, 239, 248) 28.9803%,38.2826%,rgb(231, 237, 249) 47.585%,48.1216%,rgb(230, 236, 250) 48.6583%,53.1306%,rgb(228, 236, 249) 57.6029%,61.5385%,rgb(227, 234, 250) 65.4741%,68.7835%,rgb(222, 234, 250) 72.093%,75.7603%,rgb(219, 230, 248) 79.4275%,82.8265%,rgb(216, 229, 248) 86.2254%,87.8354%,rgb(213, 228, 249) 89.4454%,91.8605%,rgb(210, 226, 249) 94.2755%,95.4383%,rgb(209, 225, 248) 96.6011%,98.3005%,rgb(208, 224, 247) 100%)'
            },
            boxShadow: {
                small: '0 8px 24px -4px rgba(91,111,151,.12)',
                medium: '0 8px 24px -4px rgba(91,111,151,.12)',
                large: '0 8px 24px -4px rgba(91,111,151,.12)',
                'side-bar':
                    '2px 2px 7.7px 0px rgba(146, 159, 202, .19), 0px 0px 1px 1px rgba(255, 255, 255, .45) inset'
            },
            borderRadius: {
                xl: 'calc(var(--radius) + 4px)',
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)'
            },
            keyframes: {
                'accordion-down': {
                    from: { height: '0' },
                    to: { height: 'var(--radix-accordion-content-height)' }
                },
                'accordion-up': {
                    from: { height: 'var(--radix-accordion-content-height)' },
                    to: { height: '0' }
                },
                'caret-blink': {
                    '0%,70%,100%': { opacity: '1' },
                    '20%,50%': { opacity: '0' }
                }
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up': 'accordion-up 0.2s ease-out',
                'caret-blink': 'caret-blink 1.25s ease-out infinite'
            },
            typography: ({ theme }) => ({
                user: {
                    css: {
                        '--tw-prose-body': colors.white,
                        '--tw-prose-headings': colors.white,
                        '--tw-prose-lead': colors.gray[600],
                        '--tw-prose-links': colors.gray[900],
                        '--tw-prose-bold': colors.white,
                        '--tw-prose-counters': colors.gray[50],
                        '--tw-prose-bullets': colors.gray[100],
                        '--tw-prose-hr': colors.gray[100],
                        '--tw-prose-quotes': colors.gray[100],
                        '--tw-prose-quote-borders': colors.gray[200],
                        '--tw-prose-captions': colors.gray[100],
                        '--tw-prose-kbd': colors.gray[900],
                        // '--tw-prose-kbd-shadows': hexToRgb(colors.gray[900]),
                        '--tw-prose-code': colors.gray[900],
                        '--tw-prose-pre-code': colors.gray[200],
                        '--tw-prose-pre-bg': colors.gray[800],
                        '--tw-prose-th-borders': colors.gray[300],
                        '--tw-prose-td-borders': colors.gray[200],
                        '--tw-prose-invert-body': colors.gray[300],
                        '--tw-prose-invert-headings': colors.white,
                        '--tw-prose-invert-lead': colors.gray[400],
                        '--tw-prose-invert-links': colors.white,
                        '--tw-prose-invert-bold': colors.white,
                        '--tw-prose-invert-counters': colors.gray[400],
                        '--tw-prose-invert-bullets': colors.gray[600],
                        '--tw-prose-invert-hr': colors.gray[700],
                        '--tw-prose-invert-quotes': colors.gray[100],
                        '--tw-prose-invert-quote-borders': colors.gray[700],
                        '--tw-prose-invert-captions': colors.gray[400],
                        '--tw-prose-invert-kbd': colors.white,
                        // "--tw-prose-invert-kbd-shadows": hexToRgb(colors.white),
                        '--tw-prose-invert-code': colors.white,
                        '--tw-prose-invert-pre-code': colors.gray[300],
                        '--tw-prose-invert-pre-bg': 'rgb(0 0 0 / 50%)',
                        '--tw-prose-invert-th-borders': colors.gray[600],
                        '--tw-prose-invert-td-borders': colors.gray[700]
                    }
                }
            })
        }
    },
    plugins: [
        require('tailwindcss-animate'),
        require('@tailwindcss/container-queries'),
        require('@tailwindcss/typography')({ target: 'legacy' })
    ]
}
