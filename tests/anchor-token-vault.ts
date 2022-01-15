import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { AnchorTokenVault } from '../target/types/anchor_token_vault';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { assert } from 'chai';

describe('anchor-token-vault', () => {

  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AnchorTokenVault as Program<AnchorTokenVault>;

  // Initial mint amount
  const MINT_A_AMOUNT = 1_000;

  // Create our user keypairs
  const user1 = anchor.web3.Keypair.generate();

  // Declare our user associated token account
  let user1TokenAAccount = null;

  // Declare our token account PDA and bump
  let pdaTokenAAddress = null;
  let pdaTokenABump = null;

  // Declare our Mint
  let mintA = null;

  // Create our payer -- this payer is tied to the mintA -- allows us to easily use mintA.<function> to send transactions, 
  // instead of using Token.<function> to create an instruction and then send the transaction manually.
  const payer = anchor.web3.Keypair.generate();

  // Create our minting authority
  const mintAuthority = anchor.web3.Keypair.generate();

  it('Initialize test state', async () => {
    // Airdrop sol to the users
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Airdrop sol to the mint authority
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(mintAuthority.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Airdrop sol to the payer
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(payer.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Create mint for mintA
    mintA = await Token.createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      0,
      TOKEN_PROGRAM_ID
    );

    // Create user1's associated token account
    user1TokenAAccount = await mintA.createAccount(user1.publicKey);

    // Mint tokens to user1's token account
    await mintA.mintTo(
      user1TokenAAccount,
      mintAuthority.publicKey,
      [mintAuthority],
      MINT_A_AMOUNT
    );

    let amount = (await mintA.getAccountInfo(user1TokenAAccount)).amount.toNumber();
    assert.equal(MINT_A_AMOUNT, amount);

    // Find our PDA's
    // For this addresses seeds, we use 'vault' as well as the tokens mint public key -- We could also use a name, but I don't feel that is necessary.
    [pdaTokenAAddress, pdaTokenABump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("vault"), mintA.publicKey.toBuffer()], program.programId);

    //console.log(`PDA Token A Address: ${pdaTokenAAddress}, Bump: ${pdaTokenABump}`);
  });

  it('Initializes our programs token vault', async () => {
    await provider.connection.confirmTransaction(
      await program.rpc.initializeVault(
        pdaTokenABump, {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            payer: payer.publicKey,
            mint: mintA.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [payer]
      })
    );

    let pdaTokenAOwningProgram = await (await provider.connection.getAccountInfo(pdaTokenAAddress)).owner;
    assert.equal(pdaTokenAOwningProgram.toString(), TOKEN_PROGRAM_ID.toString());

    let pdaTokenAAccountAmount = await (await mintA.getAccountInfo(pdaTokenAAddress)).amount.toNumber();
    assert.equal(0, pdaTokenAAccountAmount);

    // Attemp second initialization of the same vault. Our init_if_needed attribute lets us call this as much as we want,
    // but only actually does the initialization once. Without init_if_needed this transaction will throw an error.
    await provider.connection.confirmTransaction(
      await program.rpc.initializeVault(
        pdaTokenABump, {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            payer: payer.publicKey,
            mint: mintA.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [payer]
      })
    );
  });

  it('Deposits to our programs token vault', async () => {
    const AMOUNT_TO_TRANSFER = 200;

    await provider.connection.confirmTransaction(
      await program.rpc.deposit(
        new anchor.BN(AMOUNT_TO_TRANSFER), {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            depositor: user1.publicKey,
            depositorTokenAccount: user1TokenAAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user1]
      })
    );

    let pdaTokenAAccountAmount = await (await mintA.getAccountInfo(pdaTokenAAddress)).amount.toNumber();
    assert.equal(AMOUNT_TO_TRANSFER, pdaTokenAAccountAmount);

  });

});
