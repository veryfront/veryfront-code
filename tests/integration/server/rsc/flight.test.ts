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
    await withTestContext('rsc-flight-501', async (context) => {
      context.setEnv({
        VERYFRONT_EXPERIMENTAL_RSC: '1',
      })

      const { startProductionServer } = await import('../../../../src/server/production-server.ts')

      let h: Awaited<ReturnType<typeof startProductionServer>> | null = null
      try {
        await Deno.remove(`${context.projectDir}/app`, { recursive: true })

        await Deno.writeTextFile(`${context.projectDir}/pages/index.mdx`, '# Home')

        const { getFreePort } = await import('../../../_helpers/utils.ts')
        const port = await getFreePort(9000, 12000)
        h = await startProductionServer({
          projectDir: context.projectDir,
          port,
          hostname: '127.0.0.1',
        })
        await h.ready
        await new Promise((r) => setTimeout(r, 200))
        const res = await fetch(`http://127.0.0.1:${port}/_veryfront/rsc/flight_page?name=Neo`)
        assertEquals(res.status, 410)
        await res.text().catch((e) => console.debug?.('[test] flight_page text read failed', e))
      } finally {
        if (h?.stop) {
          await h.stop()
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
        await drainEventLoop(10, 50)
        await assertDrained({
          allowResources: [/MessagePort/i, /Timer/i, /^fetch/i],
          retries: 20,
          delayMs: 50,
          allowOpsDelta: 2,
        })
      }
    })
  })
})
