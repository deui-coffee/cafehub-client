import dts from 'rollup-plugin-dts'
import esbuild from 'rollup-plugin-esbuild'

function bundle(config) {
    return {
        ...config,
        external: ['events'],
    }
}

function pair(name, as = name) {
    return [
        bundle({
            input: `src/${name}.ts`,
            plugins: [esbuild()],
            output: [
                {
                    file: `${as}.mjs`,
                    format: 'es',
                },
            ],
        }),
        bundle({
            input: `src/${name}.ts`,
            plugins: [dts()],
            output: [
                {
                    file: `${as}.d.ts`,
                    format: 'es',
                },
            ],
        }),
    ]
}

export default [...pair('index'), ...pair('types')]
