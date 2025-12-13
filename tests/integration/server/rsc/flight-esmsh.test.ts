import { assertEquals } from 'std/assert/mod.ts'
import { afterAll, describe, it } from 'std/testing/bdd.ts'
import '../../../_helpers/log-guard.ts'
import { withTestContext } from '../../../_helpers/context.ts'
import { assertDrained, drainEventLoop } from '../../../_helpers/utils.ts'
import { cleanupBundler } from '../../../../src/rendering/cleanup.ts'

afterAll(async () => {
  await cleanupBundler()
})

describe('Flight endpoint', {}, () => {
  it('removed: returns 410', async () => {
    await withTestContext('rsc-flight-deno-esmsh', async (context) => {
      context.setEnv({
        VERYFRONT_EXPERIMENTAL_RSC: '1',
      })

      const { startProductionServer } = await import('../../../../src/server/production-server.ts')

      let h: Awaited<ReturnType<typeof startProductionServer>> | null = null
      try {
        await Deno.remove(`${context.projectDir}/app`, { recursive: true })
        await Deno.remove(`${context.projectDir}/pages`, { recursive: true })

        await Deno.mkdir(`${context.projectDir}/pages`, { recursive: true })
        await Deno.writeTextFile(`${context.projectDir}/pages/index.mdx`, '# Home\n')

        const { getFreePort } = await import('../../../_helpers/utils.ts')
        const port = await getFreePort(9000, 12000)
        h = await startProductionServer({
          projectDir: context.projectDir,
          port,
          hostname: '127.0.0.1',
        })
        await h.ready
        const res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/flight_page?name=Deno`)
        const _ = await res.text()
        assertEquals(res.status, 410)
      } finally {
        if (h?.stop) {
          await h.stop()
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        await drainEventLoop(3, 15)
        await assertDrained({
          allowResources: [/MessagePort/i],
          retries: 6,
          delayMs: 15,
        })
      }
    })
  })
})
