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

  // Declare our user VaultAccess PDA
  let user1VaultAccessAddress = null;
  let user1VaultAccessBump = null;

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

    console.log(`PDA Token A Address: ${pdaTokenAAddress}, Bump: ${pdaTokenABump}`);
    console.log("User1 PubKey: ", user1.publicKey.toString());
    console.log("Payer PubKey: ", payer.publicKey.toString());
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

    let pdaTokenAAccountInfo = await mintA.getAccountInfo(pdaTokenAAddress);
    let pdaTokenAOwner = pdaTokenAAccountInfo.owner;

    console.log("Token A Owner:", pdaTokenAOwner.toString());

  });

  it('Initialize a VaultAccess account for our user1', async () => {
    // Create our users VaultAccess PDA
    [user1VaultAccessAddress, user1VaultAccessBump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("vault-access"), mintA.publicKey.toBuffer(), user1.publicKey.toBuffer()], program.programId);

    await provider.connection.confirmTransaction(
      await program.rpc.initializeVaultAccess(
        user1VaultAccessBump, {
          accounts: {
            vaultAccess: user1VaultAccessAddress,
            authority: user1.publicKey,
            mint: mintA.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          },
          signers: [user1]
      })
    );

    let accessAccount = await program.account.vaultAccess.fetch(user1VaultAccessAddress);
    let authority = accessAccount.authority;
    let amount = accessAccount.amount;

    assert.equal(user1.publicKey.toString(), authority.toString());
    assert.equal(0, amount);

  });

  it('Deposits to our programs token vault', async () => {
    const AMOUNT_TO_DEPOSIT = 200;

    await provider.connection.confirmTransaction(
      await program.rpc.deposit(
        new anchor.BN(AMOUNT_TO_DEPOSIT), {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            vaultAccess: user1VaultAccessAddress,
            depositor: user1.publicKey,
            depositorTokenAccount: user1TokenAAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user1]
      })
    );

    let pdaTokenAAccountAmount = await (await mintA.getAccountInfo(pdaTokenAAddress)).amount.toNumber();
    assert.equal(AMOUNT_TO_DEPOSIT, pdaTokenAAccountAmount);

    let accessAccount = await program.account.vaultAccess.fetch(user1VaultAccessAddress);
    let amount = accessAccount.amount;

    assert.equal(AMOUNT_TO_DEPOSIT, amount);

  });

  it('Withdraw from our programs token vault', async () => {
    const AMOUNT_TO_WITHDRAW = 200;

    // Create our VaultAccess PDA
    let [vaultAccessAddress, vaultAccessBump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("vault-access"), mintA.publicKey.toBuffer(), user1.publicKey.toBuffer()], program.programId);


    await provider.connection.confirmTransaction(
      await program.rpc.withdraw(
        new anchor.BN(AMOUNT_TO_WITHDRAW),
        pdaTokenABump, {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            vaultAccess: vaultAccessAddress,
            to: user1TokenAAccount,
            authority: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user1]
      })
    );

    let pdaTokenAAccountAmount = await (await mintA.getAccountInfo(pdaTokenAAddress)).amount.toNumber();
    assert.equal(0, pdaTokenAAccountAmount);

  });

  it('Withdraw insufficient amount from our programs token vault', async () => {
    const AMOUNT_TO_DEPOSIT = 200;

    // Create a second user keypair
    let user2 = anchor.web3.Keypair.generate();

    // Airdrop sol to user2
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Create mintA associated token account for user2
    let user2TokenAAccount = await mintA.createAccount(user2.publicKey);

    // Mint to user2's token account;
    await mintA.mintTo(
      user2TokenAAccount,
      mintAuthority.publicKey,
      [mintAuthority],
      MINT_A_AMOUNT
    );

    // Create our user2 VaultAccess PDA
    let [user2VaultAccessAddress, user2VaultAccessBump] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("vault-access"), mintA.publicKey.toBuffer(), user2.publicKey.toBuffer()], program.programId);

    //console.log("Initializing user2 VaultAccess Account.")
    // Initialize user2 VaultAccess Account with PDA
    await provider.connection.confirmTransaction(
      await program.rpc.initializeVaultAccess(
        user2VaultAccessBump, {
          accounts: {
            vaultAccess: user2VaultAccessAddress,
            authority: user2.publicKey,
            mint: mintA.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          },
          signers: [user2]
      })
    );
    
    //console.log("Depositing funds to vault from user2")
    // Deposit funds to vault from user2
    await provider.connection.confirmTransaction(
      await program.rpc.deposit(
        new anchor.BN(AMOUNT_TO_DEPOSIT), {
          accounts: {
            vaultAccount: pdaTokenAAddress,
            vaultAccess: user2VaultAccessAddress,
            depositor: user2.publicKey,
            depositorTokenAccount: user2TokenAAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user2]
      })
    );

    // Withdraw more funds then deposited
    const AMOUNT_TO_WITHDRAW = AMOUNT_TO_DEPOSIT + 100;

    //console.log("Withdrawing funds from vault for user2")
    try {
      await provider.connection.confirmTransaction(
        await program.rpc.withdraw(
          new anchor.BN(AMOUNT_TO_WITHDRAW),
          pdaTokenABump, {
            accounts: {
              vaultAccount: pdaTokenAAddress,
              vaultAccess: user2VaultAccessAddress,
              to: user2TokenAAccount,
              authority: user2.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
            },
            signers: [user2]
        })
      );
    } catch (errorMessage) {
      const ERROR_MESSAGE = "Error: Insufficient funds in vault";
      console.log(errorMessage.toString());
      assert.equal(ERROR_MESSAGE, errorMessage.toString());
    }

  });

});
