//! Experimental full-screen colour-vision assistance and its ownership policy.
//!
//! A deficiency *simulation* is not a correction. For each profile, we build
//! `C = I + strength * R * (I - S)`: S estimates lost information, R shifts
//! that information towards other channels, and C is what is actually applied.
//! S uses Machado, Oliveira and Fernandes (2009), severity 1.0:
//! <https://doi.org/10.1109/TVCG.2009.113>. Type-specific R follows the
//! error-redistribution idea described at
//! <https://ixora.io/projects/colorblindness/color-blindness-simulation-research.html>.
//!
//! Those models are defined for linear-light RGB. A single Magnification API
//! 5x5 matrix cannot decode and re-encode sRGB, or perform content-aware gamut
//! mapping; Windows' actual colour pipeline varies. Thus this is an approximate
//! recolouring aid, NOT a faithful implementation of the published model, a
//! simulation, a diagnosis, or a guarantee of improved discrimination.

pub type Matrix = [[f32; 5]; 5];

pub const IDENTITY: Matrix = [
    [1.0, 0.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 0.0, 1.0],
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile { Off, Protanopia, Deuteranopia, Tritanopia }

impl Profile {
    /// Unknown stored strings fail closed rather than resetting other settings.
    pub fn parse(value: &str) -> Self {
        match value {
            "protanopia" => Self::Protanopia,
            "deuteranopia" => Self::Deuteranopia,
            "tritanopia" => Self::Tritanopia,
            _ => Self::Off,
        }
    }
    pub fn valid(value: &str) -> bool {
        matches!(value, "off" | "protanopia" | "deuteranopia" | "tritanopia")
    }
}

/// Optional replacement for the software dimmer AND warm gamma, composed with
/// (not competing with) the vision matrix. The handoff policy only requests
/// this after our gamma is safely neutral and the old overlay is hidden.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenTarget {
    pub enabled: bool,
    pub brightness: u32,
    pub kelvin: u32,
}

impl ScreenTarget {
    pub const OFF: Self = Self { enabled: false, brightness: 100, kelvin: 6500 };
    pub fn new(enabled: bool, brightness: u32, kelvin: u32) -> Self {
        if !enabled { return Self::OFF; }
        Self { enabled, brightness: brightness.clamp(10, 100), kelvin: kelvin.clamp(2700, 6500) }
    }
    pub fn wants_effect(self) -> bool {
        self.enabled && (self.brightness < 100 || self.kelvin < 6500)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target {
    pub profile: Profile,
    /// Strength of the *recolouring*, not the severity of the person's vision.
    pub strength: u32,
    pub paused: bool,
    pub screen: ScreenTarget,
}

impl Target {
    pub const OFF: Self = Self { profile: Profile::Off, strength: 0, paused: false, screen: ScreenTarget::OFF };
    pub fn new(profile: Profile, strength: u32, paused: bool) -> Self {
        Self { profile, strength: strength.min(100), paused, screen: ScreenTarget::OFF }
    }
    pub fn with_screen(mut self, screen: ScreenTarget) -> Self {
        // Color-Safe pauses both effects even if a future caller accidentally
        // submits a screen target while the whitelist is active.
        self.screen = if self.paused { ScreenTarget::OFF } else { screen };
        self
    }
    pub fn wants_vision(self) -> bool {
        self.profile != Profile::Off && self.strength > 0 && !self.paused
    }
    pub fn wants_effect(self) -> bool { self.wants_vision() || self.screen.wants_effect() }
    fn inactive_status(self) -> Status {
        if self.profile != Profile::Off && self.strength > 0 && self.paused { Status::Paused }
        else { Status::Off }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Status { Off, Pending, Active, Paused, Conflict, Error, RestoreError, Unsupported }

impl Status {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Pending, 2 => Self::Active, 3 => Self::Paused,
            4 => Self::Conflict, 5 => Self::Error, 6 => Self::RestoreError,
            7 => Self::Unsupported, _ => Self::Off,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off", Self::Pending => "pending", Self::Active => "active",
            Self::Paused => "paused", Self::Conflict => "conflict", Self::Error => "error",
            Self::RestoreError => "restoreError", Self::Unsupported => "unsupported",
        }
    }
}

// Row-major 3x3 matrices operate on column vectors. The resulting matrix is
// transposed into Win32's input-row/output-column 5x5 representation below.
fn model(profile: Profile) -> Option<([[f32; 3]; 3], [[f32; 3]; 3])> {
    let (sim, shift) = match profile {
        Profile::Off => return None,
        Profile::Protanopia => (
            [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
            [[0.0, 0.0, 0.0], [0.7, 1.0, 0.0], [0.7, 0.0, 1.0]],
        ),
        Profile::Deuteranopia => (
            [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
            [[1.0, 0.7, 0.0], [0.0, 0.0, 0.0], [0.0, 0.7, 1.0]],
        ),
        Profile::Tritanopia => (
            [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
            [[1.0, 0.0, 0.7], [0.0, 1.0, 0.7], [0.0, 0.0, 0.0]],
        ),
    };
    Some((sim, shift))
}

/// No alpha change, offsets or zoom. Strength 0 and Off are exact identities.
pub fn correction(profile: Profile, strength: u32) -> Matrix {
    let Some((sim, shift)) = model(profile) else { return IDENTITY; };
    let weight = strength.min(100) as f32 / 100.0;
    let mut result = IDENTITY;
    for output in 0..3 {
        for input in 0..3 {
            let mut delta = 0.0;
            for k in 0..3 {
                let identity = if k == input { 1.0 } else { 0.0 };
                delta += shift[output][k] * (identity - sim[k][input]);
            }
            // MAGCOLOREFFECT uses vector * matrix: row=input, column=output.
            result[input][output] += weight * delta;
        }
    }
    result
}

/// Gains from the same Tanner Helland approximation used by the existing
/// gamma engine. The supported range is 2700–6500 K; 6500 is exact identity.
/// Kept in this pure module so its policy tests do not need a Windows backend.
fn warmth_gains(kelvin: u32) -> [f32; 3] {
    let kelvin = kelvin.clamp(2700, 6500);
    if kelvin >= 6500 { return [1.0; 3]; }
    let temp = kelvin as f32 / 100.0;
    let green = (99.470_8 * temp.ln() - 161.119_57).clamp(0.0, 255.0) / 255.0;
    let blue = (138.517_73 * (temp - 10.0).ln() - 305.044_8).clamp(0.0, 255.0) / 255.0;
    [1.0, green, blue]
}

/// Compose the one fullscreen Magnification matrix in input-row/output-column
/// order. Per-channel gains approximate the old black overlay and warm gamma;
/// no alpha, offset or magnification transform is changed. A matrix can affect
/// captures and protected/HDR content differently; API success is not visual
/// confirmation. The handoff must neutralize gamma before requesting warmth.
pub fn combined_matrix(target: Target) -> Matrix {
    let mut result = if target.wants_vision() { correction(target.profile, target.strength) } else { IDENTITY };
    if target.screen.wants_effect() {
        let dim = 1.0 - 0.88 * (100 - target.screen.brightness) as f32 / 100.0;
        let warmth = warmth_gains(target.screen.kelvin);
        for row in &mut result {
            for output in 0..3 { row[output] *= dim * warmth[output]; }
        }
    }
    result
}

/// The windows 0.58 binding exposes MAGCOLOREFFECT as a flat row-major array,
/// even though the C header describes it as float[5][5]. Do not transpose here.
pub fn pack_matrix(matrix: &Matrix) -> [f32; 25] {
    let mut flat = [0.0; 25];
    for (row, values) in matrix.iter().enumerate() {
        flat[row * 5..row * 5 + 5].copy_from_slice(values);
    }
    flat
}
pub fn unpack_matrix(flat: &[f32; 25]) -> Matrix {
    let mut matrix = [[0.0; 5]; 5];
    for (row, values) in matrix.iter_mut().enumerate() {
        values.copy_from_slice(&flat[row * 5..row * 5 + 5]);
    }
    matrix
}

/// Comparison is only a best-effort ownership check, not an atomic OS lock.
pub fn same_matrix(a: &Matrix, b: &Matrix) -> bool {
    a.iter().flatten().zip(b.iter().flatten()).all(|(x, y)| x.is_finite() && y.is_finite() && (x - y).abs() < 0.00001)
}

/// An intentionally tiny backend makes the actual policy executable on a host
/// without Windows. Real Win32 calls are all made on one dedicated worker.
pub trait Backend {
    fn initialize(&mut self) -> bool;
    fn get(&mut self) -> Option<Matrix>;
    fn set(&mut self, matrix: &Matrix) -> bool;
    /// Avoid claiming the optional screen dimmer or explicitly tearing down if
    /// another fullscreen zoom is active or its state cannot be read. This is
    /// still best effort, not an atomic operating-system ownership lock.
    fn safe_to_uninitialize(&mut self) -> bool { true }
    fn uninitialize(&mut self) -> bool;
}

#[derive(Clone, Copy)]
struct UncertainWrite {
    before: Option<Matrix>,
    before_screen: bool,
    attempted: Matrix,
    attempted_screen: bool,
}

pub struct Controller<B: Backend> {
    pub backend: B,
    initialized: bool,
    owned: Option<Matrix>,
    owned_screen: bool,
    // A failed write followed by a failed read may nevertheless have changed
    // the display. Keep the handoff conservative until a later read resolves it.
    uncertain: Option<UncertainWrite>,
    blocked: bool,
    previous: Option<Target>,
}

impl<B: Backend> Controller<B> {
    pub fn new(backend: B) -> Self {
        Self { backend, initialized: false, owned: None, owned_screen: false,
            uncertain: None, blocked: false, previous: None }
    }

    /// Includes a failed, unreadable screen write: gamma and the old overlay
    /// must not resume until the ambiguous result can be observed and released.
    pub fn owns_screen_effect(&self) -> bool {
        (self.owned.is_some() && self.owned_screen)
            || self.uncertain.is_some_and(|u| u.attempted_screen || u.before_screen)
    }

    /// Apply only against identity or our last matrix. If another effect is
    /// detected, never repeatedly fight it; an explicit retry or a changed
    /// selection is required. All get/set checks remain inherently racy.
    pub fn step(&mut self, target: Target, retry: bool) -> Status {
        let changed = self.previous != Some(target);
        self.previous = Some(target);
        if let Some(pending) = self.uncertain {
            let Some(current) = self.backend.get() else {
                return if target.wants_effect() { Status::Error } else { Status::RestoreError };
            };
            self.uncertain = None;
            if same_matrix(&current, &pending.attempted) {
                self.owned = Some(pending.attempted);
                self.owned_screen = pending.attempted_screen;
            } else if pending.before.as_ref().is_some_and(|before| same_matrix(&current, before)) {
                self.owned = pending.before;
                self.owned_screen = pending.before_screen;
            } else if pending.before.is_none() && same_matrix(&current, &IDENTITY) {
                self.owned = None;
                self.owned_screen = false;
            } else {
                // A different writer won. Never guess or reset their matrix.
                self.owned = None;
                self.owned_screen = false;
                if target.wants_effect() { self.blocked = true; return Status::Conflict; }
                return target.inactive_status();
            }
        }
        if !target.wants_effect() {
            self.blocked = false;
            if let Some(last) = self.owned {
                let Some(current) = self.backend.get() else { return Status::RestoreError; };
                if !same_matrix(&current, &last) {
                    // The last writer is no longer us. Never reset their matrix.
                    self.owned = None;
                    self.owned_screen = false;
                } else if !self.backend.set(&IDENTITY) {
                    // Keep ownership so a later inactive step can retry.
                    return Status::RestoreError;
                } else {
                    self.owned = None;
                    self.owned_screen = false;
                }
            }
            return target.inactive_status();
        }

        if self.blocked && !changed && !retry { return Status::Conflict; }
        if changed || retry { self.blocked = false; }
        if !self.initialized {
            if !self.backend.initialize() { return Status::Error; }
            self.initialized = true;
        }
        let Some(current) = self.backend.get() else { return Status::Error; };
        if let Some(last) = self.owned {
            if !same_matrix(&current, &last) {
                self.owned = None;
                self.owned_screen = false;
                self.blocked = true;
                return Status::Conflict;
            }
        } else if !same_matrix(&current, &IDENTITY) {
            self.blocked = true;
            return Status::Conflict;
        }
        // Do not newly acquire the optional screen effect over an active zoom.
        // The earlier colour-vision-only behaviour remains independent.
        if target.screen.wants_effect() && !self.owned_screen && !self.backend.safe_to_uninitialize() {
            self.blocked = true;
            return Status::Conflict;
        }
        let next = combined_matrix(target);
        if self.owned.is_some() && same_matrix(&current, &next) {
            self.owned_screen = target.screen.wants_effect();
            return Status::Active;
        }
        if self.backend.set(&next) {
            self.owned = Some(next);
            self.owned_screen = target.screen.wants_effect();
            Status::Active
        } else {
            // An API failure may still have changed the matrix. If the follow-up
            // read fails too, track both possible values rather than allowing
            // gamma/overlay to resume over an unknown warm screen effect.
            match self.backend.get() {
                Some(m) if same_matrix(&m, &next) => {
                    self.owned = Some(next);
                    self.owned_screen = target.screen.wants_effect();
                }
                None => self.uncertain = Some(UncertainWrite {
                    before: self.owned, before_screen: self.owned_screen,
                    attempted: next, attempted_screen: target.screen.wants_effect(),
                }),
                Some(_) => {}
            }
            Status::Error
        }
    }

    /// Called on the same worker as initialize/get/set. Avoid explicitly
    /// uninitializing over a newly observed external matrix: Microsoft's sample
    /// notes that MagUninitialize can turn off the current fullscreen effect.
    /// Process termination and races may still interfere; no OS ownership lock
    /// is provided. Return false if our own restoration could not be confirmed.
    pub fn shutdown(&mut self) -> bool {
        let restored = self.step(Target::OFF, false) != Status::RestoreError;
        if self.initialized {
            let current = self.backend.get();
            let safe = current.as_ref().is_some_and(|m| {
                same_matrix(m, &IDENTITY) || self.owned.as_ref().is_some_and(|own| same_matrix(m, own))
            });
            if safe && self.backend.safe_to_uninitialize() {
                let ok = self.backend.uninitialize();
                self.initialized = false;
                return restored && ok;
            }
            // Release process resources at exit rather than actively clearing
            // an external effect or guessing when the read failed.
            return restored && current.is_some();
        }
        restored
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        current: Option<Matrix>, writes: Vec<Matrix>, inits: usize, uninit: usize,
        fail_init: bool, fail_read: bool, fail_write: bool, zoom_active: bool,
        fail_read_after_write: bool, write_before_failure: bool,
    }
    impl Fake { fn new() -> Self { Self { current: Some(IDENTITY), ..Self::default() } } }
    impl Backend for Fake {
        fn initialize(&mut self) -> bool { self.inits += 1; !self.fail_init }
        fn get(&mut self) -> Option<Matrix> { if self.fail_read { None } else { self.current } }
        fn set(&mut self, value: &Matrix) -> bool {
            self.writes.push(*value);
            if self.fail_write {
                if self.write_before_failure { self.current = Some(*value); }
                if self.fail_read_after_write { self.fail_read = true; }
                false
            } else { self.current = Some(*value); true }
        }
        fn safe_to_uninitialize(&mut self) -> bool { !self.zoom_active }
        fn uninitialize(&mut self) -> bool { self.uninit += 1; true }
    }
    fn target(profile: Profile) -> Target { Target::new(profile, 60, false) }
    fn transform(m: &Matrix, c: [f32; 3]) -> [f32; 3] {
        let mut result = [0.0; 3];
        for out in 0..3 { for input in 0..3 { result[out] += c[input] * m[input][out]; } }
        result
    }
    fn model_distance(profile: Profile, a: [f32; 3], b: [f32; 3], correction_on: bool) -> f32 {
        let sim = model(profile).unwrap().0;
        let matrix = if correction_on { correction(profile, 60) } else { IDENTITY };
        let apply = |x: [f32; 3]| -> [f32; 3] {
            let x = transform(&matrix, x);
            let mut result = [0.0; 3];
            for i in 0..3 { for j in 0..3 { result[i] += sim[i][j] * x[j]; } }
            result
        };
        let a = apply(a); let b = apply(b);
        ((a[0]-b[0]).powi(2) + (a[1]-b[1]).powi(2) + (a[2]-b[2]).powi(2)).sqrt()
    }

    #[test]
    fn identities_bounds_orientation_and_neutral_gray() {
        assert_eq!(correction(Profile::Off, 100), IDENTITY);
        for p in [Profile::Protanopia, Profile::Deuteranopia, Profile::Tritanopia] {
            assert_eq!(correction(p, 0), IDENTITY);
            assert_eq!(correction(p, 500), correction(p, 100));
            let m = correction(p, 60);
            assert!(!same_matrix(&m, &IDENTITY));
            assert_eq!(m[3], IDENTITY[3]); assert_eq!(m[4], IDENTITY[4]);
            for (i, row) in m.iter().enumerate() {
                assert_eq!(row[3], if i == 3 { 1.0 } else { 0.0 });
                assert_eq!(row[4], if i == 4 { 1.0 } else { 0.0 });
            }
            let gray = transform(&m, [0.5; 3]);
            for x in gray { assert!((x - 0.5).abs() < 0.00001); }
        }
        // Protan's red output is unchanged but red contributes to blue; this
        // pins the Win32 transpose, not merely the diagonal of the matrix.
        let m = correction(Profile::Protanopia, 60);
        assert_eq!(m[0][0], 1.0); assert_eq!(m[1][0], 0.0);
        assert!(m[0][2] > 0.3 && m[1][2] < -0.4);
        assert!(!same_matrix(&correction(Profile::Protanopia, 60), &correction(Profile::Deuteranopia, 60)));
        assert!(!same_matrix(&correction(Profile::Deuteranopia, 60), &correction(Profile::Tritanopia, 60)));
    }

    #[test]
    fn windows_flat_binding_preserves_row_major_orientation() {
        let matrix = correction(Profile::Protanopia, 60);
        let flat = pack_matrix(&matrix);
        assert_eq!(flat[2], matrix[0][2]);
        assert_eq!(flat[5], matrix[1][0]);
        assert_ne!(flat[2], flat[5], "transpose errors must not be hidden");
        assert_eq!(flat[18], 1.0); assert_eq!(flat[24], 1.0);
        assert_eq!(unpack_matrix(&flat), matrix);
    }

    #[test]
    fn correction_redistributes_model_error_rather_than_showing_simulation() {
        // These are algebraic sanity checks on a few in-gamut samples, not a
        // clinical result or a claim about the Windows physical pipeline.
        let cases = [
            (Profile::Protanopia, [0.12,0.58,0.75], [0.81,0.49,0.78]),
            (Profile::Deuteranopia, [0.15,0.48,0.70], [0.76,0.24,0.70]),
            (Profile::Tritanopia, [0.76,0.47,0.85], [0.73,0.53,0.60]),
        ];
        for (profile, a, b) in cases {
            assert!(model_distance(profile, a, b, true) > model_distance(profile, a, b, false) * 1.5);
            let (sim, _) = model(profile).unwrap();
            let matrix = correction(profile, 60);
            assert!((matrix[0][0] - sim[0][0]).abs() > 0.01);
        }
    }

    #[test]
    fn change_pause_resume_off_and_no_redundant_writes() {
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert_eq!(c.backend.inits, 0); assert!(c.backend.writes.is_empty());
        let p = target(Profile::Protanopia);
        assert_eq!(c.step(p, false), Status::Active);
        assert_eq!(c.step(p, false), Status::Active);
        assert_eq!(c.backend.writes.len(), 1);
        assert_eq!(c.step(target(Profile::Tritanopia), false), Status::Active);
        let paused = Target::new(Profile::Tritanopia, 60, true);
        assert_eq!(c.step(paused, false), Status::Paused);
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        assert_eq!(c.step(target(Profile::Tritanopia), false), Status::Active);
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        assert!(c.shutdown()); assert_eq!(c.backend.uninit, 1);
    }

    #[test]
    fn existing_or_later_effect_is_not_overwritten_and_retry_is_explicit() {
        let mut external = IDENTITY; external[0][0] = 0.5;
        let mut c = Controller::new(Fake::new()); c.backend.current = Some(external);
        let p = target(Profile::Deuteranopia);
        assert_eq!(c.step(p, false), Status::Conflict); assert!(c.backend.writes.is_empty());
        c.backend.current = Some(IDENTITY);
        assert_eq!(c.step(p, false), Status::Conflict); assert!(c.backend.writes.is_empty());
        assert_eq!(c.step(p, true), Status::Active);
        c.backend.current = Some(external);
        assert_eq!(c.step(p, false), Status::Conflict);
        let writes = c.backend.writes.len();
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert_eq!(c.backend.writes.len(), writes); assert_eq!(c.backend.current.unwrap(), external);
        assert!(c.shutdown()); assert_eq!(c.backend.uninit, 0, "do not explicitly uninitialize over an external effect");
    }

    #[test]
    fn shutdown_does_not_explicitly_uninitialize_over_a_fullscreen_zoom() {
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(target(Profile::Protanopia), false), Status::Active);
        c.backend.zoom_active = true;
        assert!(c.shutdown());
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        assert_eq!(c.backend.uninit, 0);
    }

    #[test]
    fn restore_failure_is_reported_and_retried_even_when_switched_off() {
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(target(Profile::Tritanopia), false), Status::Active);
        c.backend.fail_write = true;
        assert_eq!(c.step(Target::OFF, false), Status::RestoreError);
        assert!(!same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        c.backend.fail_write = false;
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
    }

    #[test]
    fn errors_never_claim_success_or_reset_an_unknown_effect() {
        let mut c = Controller::new(Fake::new());
        let p = target(Profile::Protanopia);
        c.backend.fail_init = true; assert_eq!(c.step(p, false), Status::Error);
        c.backend.fail_init = false; c.backend.fail_read = true;
        assert_eq!(c.step(p, false), Status::Error); assert!(c.backend.writes.is_empty());
        assert!(!c.shutdown()); assert_eq!(c.backend.uninit, 0);
    }

    #[test]
    fn fullscreen_matrix_combines_gamma_warmth_dimming_and_vision_once() {
        let screen = ScreenTarget::new(true, 70, 3000);
        let screen_only = Target::new(Profile::Off, 60, false).with_screen(screen);
        assert!(screen_only.wants_effect()); assert!(!screen_only.wants_vision());
        let m = combined_matrix(screen_only);
        let dim = 1.0 - 0.88 * 0.30;
        let warm = warmth_gains(3000);
        let expected = [dim * warm[0], dim * warm[1], dim * warm[2]];
        let white = transform(&m, [1.0; 3]);
        for i in 0..3 { assert!((white[i] - expected[i]).abs() < 0.00001); }
        assert!(white[0] > white[1] && white[1] > white[2]);
        assert_eq!(m[3], IDENTITY[3]); assert_eq!(m[4], IDENTITY[4]);
        let vision = target(Profile::Protanopia);
        let input = [0.3, 0.6, 0.9];
        let vision_result = transform(&combined_matrix(vision), input);
        let combined = transform(&combined_matrix(vision.with_screen(screen)), input);
        for i in 0..3 { assert!((combined[i] - vision_result[i] * expected[i]).abs() < 0.00001); }
        assert_eq!(combined_matrix(Target::OFF.with_screen(ScreenTarget::new(false, 10, 2700))), IDENTITY);
        assert_eq!(ScreenTarget::new(true, 0, 1), ScreenTarget::new(true, 10, 2700));
        assert!(!ScreenTarget::new(true, 100, 6500).wants_effect());
        let warmth_only = Target::OFF.with_screen(ScreenTarget::new(true, 100, 3000));
        assert!(warmth_only.wants_effect(), "warmth works even at full software brightness");
        assert!(combined_matrix(warmth_only)[2][2] < 1.0);
        let paused = Target::new(Profile::Deuteranopia, 60, true).with_screen(screen);
        assert!(!paused.wants_effect(), "whitelist must pause the composed screen effect too");
        assert_eq!(combined_matrix(paused), IDENTITY);
    }

    #[test]
    fn screen_and_vision_share_ownership_and_restore_independently() {
        let mut c = Controller::new(Fake::new());
        let screen = ScreenTarget::new(true, 72, 6500);
        let screen_only = Target::new(Profile::Off, 0, false).with_screen(screen);
        let both = target(Profile::Deuteranopia).with_screen(screen);
        assert_eq!(c.step(screen_only, false), Status::Active);
        assert!(c.owns_screen_effect());
        assert_eq!(c.step(both, false), Status::Active);
        assert!(c.owns_screen_effect());
        assert!(same_matrix(&c.backend.current.unwrap(), &combined_matrix(both)));
        assert_eq!(c.step(target(Profile::Deuteranopia), false), Status::Active);
        assert!(!c.owns_screen_effect());
        assert!(same_matrix(&c.backend.current.unwrap(), &correction(Profile::Deuteranopia, 60)));
        assert_eq!(c.step(both, false), Status::Active);
        // A failed transition to vision-only must retain the old screen-owned
        // flag; adding the overlay at that point would double-dim the display.
        c.backend.fail_write = true;
        assert_eq!(c.step(target(Profile::Deuteranopia), false), Status::Error);
        assert!(c.owns_screen_effect());
        c.backend.fail_write = false;
        assert_eq!(c.step(target(Profile::Deuteranopia), false), Status::Active);
        assert!(!c.owns_screen_effect());
        let paused = Target::new(Profile::Deuteranopia, 60, true);
        assert_eq!(c.step(paused, false), Status::Paused);
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
    }

    #[test]
    fn failed_unreadable_screen_write_is_owned_until_resolved() {
        let screen = Target::OFF.with_screen(ScreenTarget::new(true, 70, 3000));
        for changed_despite_failure in [false, true] {
            let mut c = Controller::new(Fake::new());
            c.backend.fail_write = true;
            c.backend.fail_read_after_write = true;
            c.backend.write_before_failure = changed_despite_failure;
            assert_eq!(c.step(screen, false), Status::Error);
            assert!(c.owns_screen_effect(), "unknown result must prevent gamma/overlay fallback");
            assert_eq!(c.step(Target::OFF, false), Status::RestoreError);
            assert!(c.owns_screen_effect());
            c.backend.fail_read = false;
            c.backend.fail_write = false;
            assert_eq!(c.step(Target::OFF, false), Status::Off);
            assert!(!c.owns_screen_effect());
            assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        }
    }

    #[test]
    fn ambiguous_handoff_recovers_either_old_or_new_matrix_without_guessing() {
        let mut c = Controller::new(Fake::new());
        let screen = Target::OFF.with_screen(ScreenTarget::new(true, 70, 3000));
        let vision = target(Profile::Tritanopia);
        assert_eq!(c.step(screen, false), Status::Active);
        c.backend.fail_write = true;
        c.backend.fail_read_after_write = true;
        assert_eq!(c.step(vision, false), Status::Error);
        assert!(c.owns_screen_effect());
        c.backend.fail_read = false; c.backend.fail_write = false;
        assert_eq!(c.step(vision, false), Status::Active);
        assert!(!c.owns_screen_effect());
        assert!(same_matrix(&c.backend.current.unwrap(), &combined_matrix(vision)));

        let mut external_case = Controller::new(Fake::new());
        external_case.backend.fail_write = true;
        external_case.backend.fail_read_after_write = true;
        assert_eq!(external_case.step(screen, false), Status::Error);
        let mut other = IDENTITY; other[1][1] = 0.42;
        external_case.backend.current = Some(other);
        external_case.backend.fail_read = false;
        assert_eq!(external_case.step(screen, false), Status::Conflict);
        assert!(!external_case.owns_screen_effect());
        assert_eq!(external_case.backend.current, Some(other));
    }

    #[test]
    fn fullscreen_screen_effect_respects_zoom_conflicts_and_external_takeovers() {
        let mut c = Controller::new(Fake::new());
        c.backend.zoom_active = true;
        let screen = Target::OFF.with_screen(ScreenTarget::new(true, 75, 6500));
        assert_eq!(c.step(screen, false), Status::Conflict);
        assert!(!c.owns_screen_effect()); assert!(c.backend.writes.is_empty());
        c.backend.zoom_active = false;
        assert_eq!(c.step(screen, false), Status::Conflict, "retry must be explicit");
        assert_eq!(c.step(screen, true), Status::Active);
        assert!(c.owns_screen_effect());
        let mut external = IDENTITY; external[1][1] = 0.5;
        c.backend.current = Some(external);
        assert_eq!(c.step(screen, false), Status::Conflict);
        assert!(!c.owns_screen_effect());
        let n = c.backend.writes.len();
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert_eq!(c.backend.writes.len(), n);
        assert_eq!(c.backend.current, Some(external));
    }

    #[test]
    fn settings_parse_fail_closed_and_zero_strength_is_off() {
        assert_eq!(Profile::parse("unknown"), Profile::Off);
        assert!(!Profile::valid("unknown")); assert!(Profile::valid("tritanopia"));
        assert_eq!(Target::new(Profile::Tritanopia, 1000, false).strength, 100);
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(Target::new(Profile::Tritanopia, 0, false), false), Status::Off);
        assert_eq!(c.step(Target::new(Profile::Tritanopia, 60, true), false), Status::Paused);
        assert_eq!(c.backend.inits, 0); assert!(c.backend.writes.is_empty());
    }
}
