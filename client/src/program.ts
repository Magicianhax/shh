import * as anchor from "@coral-xyz/anchor";
import { IDL } from "./constants";

/**
 * The program with its `methods` and `account` namespaces left untyped.
 *
 * The IDL is loaded from JSON at runtime rather than generated into a TS type,
 * so `Program<any>` gives no useful completion on those two namespaces and its
 * generic machinery hits TS2589 ("type instantiation is excessively deep").
 * Every account object in this library is instead checked by hand against the
 * IDL account order.
 */
export type AnyProgram = Omit<anchor.Program<any>, "methods" | "account"> & {
  methods: any;
  account: any;
};

/**
 * Bind the program to a provider. Call once per connection: the base-layer
 * provider for base instructions, and an ER provider for delegated ones.
 */
export const loadProgram = (provider: anchor.AnchorProvider): AnyProgram =>
  new anchor.Program(IDL, provider) as unknown as AnyProgram;
