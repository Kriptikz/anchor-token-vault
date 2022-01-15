use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Mint, Token, Transfer};

declare_id!("GX2r6F2RzNAoR54oZ3EgrDwnUYJvW24cJpZnBnULRGiV");

#[program]
pub mod anchor_token_vault {
    use super::*;
    pub fn initialize_vault(_ctx: Context<InitializeVault>, _bump: u8) -> ProgramResult {
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> ProgramResult {
        // verify the vault is our vault PDA of the tokens mint
        let mint = ctx.accounts.depositor_token_account.mint;
        let (pda, _bump) = Pubkey::find_program_address(&[b"vault", mint.as_ref()], &id());

        if pda != ctx.accounts.vault_account.key() {
            return Err(ErrorCode::InvalidPdaVault.into())
        }

        token::transfer((&*ctx.accounts).into(), amount)?;

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
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault_account: Account<'info, TokenAccount>,
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

#[error]
pub enum ErrorCode {
    #[msg("Error: Invalid PDA vault account")]
    InvalidPdaVault,
}
