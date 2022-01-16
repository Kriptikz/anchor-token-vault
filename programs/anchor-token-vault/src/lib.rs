use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Mint, Token, Transfer};

declare_id!("GX2r6F2RzNAoR54oZ3EgrDwnUYJvW24cJpZnBnULRGiV");

#[program]
pub mod anchor_token_vault {
    use super::*;
    pub fn initialize_vault(_ctx: Context<InitializeVault>, _bump: u8) -> ProgramResult {
        Ok(())
    }

    pub fn initialize_vault_access(ctx: Context<InitializeAccess>, _bump: u8) -> ProgramResult {
        // Verify the vault access address is the correct PDA
        let (pda, _) = Pubkey::find_program_address(&[b"vault-access", ctx.accounts.mint.key().as_ref(), ctx.accounts.authority.key().as_ref()], &id());

        if pda != ctx.accounts.vault_access.key() {
            return Err(ErrorCode::InvalidPdaVaultAccess.into())
        }

        ctx.accounts.vault_access.authority = ctx.accounts.authority.key();
        ctx.accounts.vault_access.amount = 0;

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> ProgramResult {
        // verify the vault is our vault PDA of the tokens mint
        let mint = ctx.accounts.depositor_token_account.mint;
        let (pda, _) = Pubkey::find_program_address(&[b"vault", mint.as_ref()], &id());

        if pda != ctx.accounts.vault_account.key() {
            return Err(ErrorCode::InvalidPdaVault.into())
        }

        // Verify the vault access address is the correct PDA
        let (pda, _) = Pubkey::find_program_address(&[b"vault-access", mint.as_ref(), ctx.accounts.depositor.key().as_ref()], &id());

        if pda != ctx.accounts.vault_access.key() {
            return Err(ErrorCode::InvalidPdaVaultAccess.into())
        }

        token::transfer((&*ctx.accounts).into(), amount)?;

        ctx.accounts.vault_access.amount += amount;

        Ok(())
    }

    // I actually don't need the bump here since I use find_program_address anyways...
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64, bump: u8) -> ProgramResult {
        // verify the vault is our vault PDA of the tokens mint
        let mint = ctx.accounts.to.mint;
        let (pda, _) = Pubkey::find_program_address(&[b"vault", mint.as_ref()], &id());

        if pda != ctx.accounts.vault_account.key() {
            return Err(ErrorCode::InvalidPdaVault.into())
        }

        // Verify the vault access address is the correct PDA
        let (pda, _) = Pubkey::find_program_address(&[b"vault-access", mint.as_ref(), ctx.accounts.authority.key().as_ref()], &id());

        if pda != ctx.accounts.vault_access.key() {
            return Err(ErrorCode::InvalidPdaVaultAccess.into())
        }


        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_account.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.vault_account.to_account_info(),
        };

        if amount > ctx.accounts.vault_access.amount {
            return Err(ErrorCode::InsufficientFundsInVault.into())
        }

        ctx.accounts.vault_access.amount -= amount;

        token::transfer(
            CpiContext::new_with_signer(
                cpi_program, 
                cpi_accounts,
                &[&[b"vault", mint.as_ref(), &[bump]]]), 
            amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeVault<'info> {
    #[account(init_if_needed,
        payer = payer,
        seeds = [b"vault", mint.key().as_ref()],
        bump = bump,
        token::mint = mint,
        token::authority = vault_account)]
    pub vault_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitializeAccess<'info> {
    #[account(init_if_needed, 
        payer = authority, 
        seeds = [b"vault-access", mint.key().as_ref(), authority.key().as_ref()],
        bump = bump,
        space = 8 + 32 + 8)]
    pub vault_access: Account<'info, VaultAccess>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_access.authority == depositor.key())]
    pub vault_access: Account<'info, VaultAccess>,
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> From<&Deposit<'info>> for CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
    fn from(accounts: &Deposit<'info>) -> Self {
        let cpi_program = accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: accounts.depositor_token_account.to_account_info(),
            to: accounts.vault_account.to_account_info(),
            authority: accounts.depositor.to_account_info(),
        };

        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_access.authority == authority.key())]
    pub vault_access: Account<'info, VaultAccess>,
    #[account(mut, constraint = to.owner == authority.key())]
    pub to: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VaultAccess {
    authority: Pubkey, // 32
    amount: u64,       // 8
}

#[error]
pub enum ErrorCode {
    #[msg("Error: Invalid PDA vault account")]
    InvalidPdaVault,
    #[msg("Error: Invalid PDA vault access account")]
    InvalidPdaVaultAccess,
    #[msg("Error: Insufficient funds in vault")]
    InsufficientFundsInVault,
}
