// Spike-only declaration shim for the Typert protocol. The generator only
// recognises @Remote / TypertRemoteService when their declarations belong to a
// package registered through the face's project references, so an external
// workspace must vendor this shim under packages/.
import type { Context } from '@deepseek-ai/cordis'

/** Minimal shape the generator inspects for a Remote service base class. */
export declare abstract class TypertRemoteService<T = never> {
  protected constructor(ctx: Context, serviceKey: string, options?: unknown)
}

/** Method decorator marking one Remote endpoint by export name. */
export declare function Remote(name: string): MethodDecorator

type MethodDecorator = (target: object, context: ClassMethodDecoratorContext) => void
